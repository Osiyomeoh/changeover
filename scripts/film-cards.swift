// Renders the video's text panels and cards to PNG for scripts/film-cut.py (ffmpeg here has no drawtext).
// Input: a JSON file, a list of {out, w, h, bg?: [r,g,b,a], items: [{text, x, y, w, size, weight?, color?, align?}]}
// with top-left coordinates in pixels and colours in 0..1. A negative y stacks the item that many pixels below
// the previous one. System font only.
// Usage: swift scripts/film-cards.swift cards.json
import AppKit
import Foundation

struct Item: Decodable {
    let text: String
    let x: Double, y: Double, w: Double, size: Double
    let weight: String?
    let color: [Double]?
    let align: String?
}

struct Card: Decodable {
    let out: String
    let w: Int, h: Int
    let bg: [Double]?
    let items: [Item]
}

func rgba(_ c: [Double]) -> NSColor {
    NSColor(deviceRed: c[0], green: c[1], blue: c[2], alpha: c.count > 3 ? c[3] : 1)
}

let weights: [String: NSFont.Weight] = [
    "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold, "heavy": .heavy,
]

let cards = try JSONDecoder().decode([Card].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
for c in cards {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: c.w, pixelsHigh: c.h, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0),
          let base = NSGraphicsContext(bitmapImageRep: rep) else { fatalError("no bitmap for \(c.out)") }
    let cg = base.cgContext
    cg.translateBy(x: 0, y: CGFloat(c.h))
    cg.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
    if let bg = c.bg {
        rgba(bg).setFill()
        NSRect(x: 0, y: 0, width: c.w, height: c.h).fill()
    }
    var bottom = 0.0
    for it in c.items {
        let font = NSFont.systemFont(ofSize: CGFloat(it.size), weight: weights[it.weight ?? "regular"] ?? .regular)
        let ps = NSMutableParagraphStyle()
        ps.alignment = it.align == "center" ? .center : (it.align == "right" ? .right : .left)
        ps.lineSpacing = CGFloat(it.size * 0.18)
        let s = NSAttributedString(string: it.text, attributes: [
            .font: font, .foregroundColor: rgba(it.color ?? [1, 1, 1, 1]), .paragraphStyle: ps,
        ])
        let opts: NSString.DrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
        let y = it.y >= 0 ? it.y : bottom - it.y
        let r = s.boundingRect(with: NSSize(width: it.w, height: 4000), options: opts)
        s.draw(with: NSRect(x: it.x, y: y, width: it.w, height: 4000), options: opts)
        bottom = y + Double(r.height)
    }
    NSGraphicsContext.current = nil
    guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("no png for \(c.out)") }
    try png.write(to: URL(fileURLWithPath: c.out))
    print(c.out)
}
