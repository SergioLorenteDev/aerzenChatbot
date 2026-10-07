import Foundation
import PDFKit
import Vision
import AppKit

struct OCRLine: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

if CommandLine.arguments.count < 3 {
    fputs("Usage: extract_pdf_layout.swift <pdf-path> <page-number>\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
guard let pageNumber = Int(CommandLine.arguments[2]), pageNumber > 0 else {
    fputs("Invalid page number\n", stderr)
    exit(1)
}

let pdfUrl = URL(fileURLWithPath: pdfPath)
guard let document = PDFDocument(url: pdfUrl), let page = document.page(at: pageNumber - 1) else {
    fputs("Unable to open PDF or page: \(pdfPath) page \(pageNumber)\n", stderr)
    exit(1)
}

let pageRect = page.bounds(for: .mediaBox)
let targetWidth: CGFloat = 2200
let scale = targetWidth / pageRect.width
let targetHeight = pageRect.height * scale

let image = NSImage(size: NSSize(width: targetWidth, height: targetHeight))
image.lockFocus()
NSColor.white.set()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: targetWidth, height: targetHeight)).fill()
let context = NSGraphicsContext.current!.cgContext
context.saveGState()
context.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: context)
context.restoreGState()
image.unlockFocus()

guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Unable to render page image\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["es-ES", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
    guard let candidate = observation.topCandidates(1).first else {
        return nil
    }
    let box = observation.boundingBox
    return OCRLine(
        text: candidate.string,
        x: box.minX,
        y: box.minY,
        width: box.width,
        height: box.height
    )
}
    .sorted { left, right in
        if abs(left.y - right.y) > 0.004 {
            return left.y > right.y
        }
        return left.x < right.x
    }

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(lines)
print(String(decoding: data, as: UTF8.self))
