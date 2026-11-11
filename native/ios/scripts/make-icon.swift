// Genera el icono de la app de iPhone/iPad a partir del icono de Aula para macOS (build/icon.png, con su rejilla y
// esquinas transparentes): iOS quiere un cuadrado entero y opaco, sin márgenes (él recorta las esquinas).
//   xcrun swift native/ios/scripts/make-icon.swift build/icon.png native/ios/Aula/Assets.xcassets/AppIcon.appiconset/icon-1024.png
// La marca que la app enseña mientras conecta (Mark.imageset) es ese mismo icono a 360 px; después de rehacerlo:
//   sips -Z 360 native/ios/Aula/Assets.xcassets/AppIcon.appiconset/icon-1024.png --out native/ios/Aula/Assets.xcassets/Mark.imageset/mark.png
import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1])?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("uso: make-icon.swift <icono de macOS.png> <salida.png>\n".utf8)); exit(1)
}
let size = 1024
// en la rejilla de macOS el cuadrado redondeado ocupa 824 de los 1024 px, centrado
let inner = 824.0 * Double(src.width) / 1024.0
let scale = Double(size) / inner
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
// el papel del propio icono, para que las esquinas (transparentes en el de macOS) no se noten
ctx.setFillColor(CGColor(srgbRed: 0.965, green: 0.941, blue: 0.890, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
ctx.interpolationQuality = .high
let drawn = Double(src.width) * scale
ctx.draw(src, in: CGRect(x: (Double(size) - drawn) / 2, y: (Double(size) - drawn) / 2, width: drawn, height: drawn))
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
guard CGImageDestinationFinalize(dest) else { exit(1) }
print("icono:", args[2])
