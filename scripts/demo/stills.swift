// Decode stills from an MP4 at given seconds (REL-01 check that the video plays and is legible).
// Usage: swift scripts/demo/stills.swift VIDEO.mp4 OUT_DIR 5 20 45 ...
import AVFoundation
import AppKit

let args = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let out = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let generator = AVAssetImageGenerator(asset: asset)
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
let duration = CMTimeGetSeconds(asset.duration)
let track = asset.tracks(withMediaType: .video).first!
print(String(format: "duration %.2f s, %.0fx%.0f, %.1f fps, codec %@", duration, track.naturalSize.width, track.naturalSize.height, track.nominalFrameRate,
  CMFormatDescriptionGetMediaSubType(track.formatDescriptions.first as! CMFormatDescription) == kCMVideoCodecType_H264 ? "H.264" : "other"))
for s in args.dropFirst(3) {
  let image = try generator.copyCGImage(at: CMTime(seconds: Double(s)!, preferredTimescale: 600), actualTime: nil)
  let rep = NSBitmapImageRep(cgImage: image)
  try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("t\(s).png"))
}
print("ok")
