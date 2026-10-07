import Foundation
import PDFKit

if CommandLine.arguments.count < 2 {
    fputs("Usage: extract_pdf_text.swift <pdf-path>\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
let pdfUrl = URL(fileURLWithPath: pdfPath)

guard let document = PDFDocument(url: pdfUrl) else {
    fputs("Unable to open PDF: \(pdfPath)\n", stderr)
    exit(1)
}

var output = ""
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let pageText = page.string ?? ""
    output += "\n--- PAGE \(index + 1) ---\n"
    output += pageText
    output += "\n"
}

print(output)
