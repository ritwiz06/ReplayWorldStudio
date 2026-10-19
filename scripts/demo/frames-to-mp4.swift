// Turn the demo's screencast frames into an H.264 MP4 (REL-01), with macOS's own AVFoundation:
// no ffmpeg needed. Frames arrive only when the page changes, so each output frame shows the
// latest screencast frame at its time (constant frame rate, real-time pacing).
// Usage: swift scripts/demo/frames-to-mp4.swift FRAMES_DIR OUT.mp4 [fps] [bits_per_second]
import AVFoundation
import CoreImage
import Foundation

struct Frame: Decodable { let file: String; let t: Double }
struct Log: Decodable { let frames: [Frame] }

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: frames-to-mp4 FRAMES_DIR OUT.mp4 [fps] [bps]"); exit(2) }
let dir = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let fps = args.count > 3 ? Int32(args[3])! : 25
let bps = args.count > 4 ? Int(args[4])! : 2_000_000
let log = try JSONDecoder().decode(Log.self, from: Data(contentsOf: dir.appendingPathComponent("frames.json")))
let frames = log.frames.sorted { $0.t < $1.t }
guard let first = frames.first, let last = frames.last else { print("no frames"); exit(1) }

let context = CIContext()
func image(_ f: Frame) -> CIImage { CIImage(contentsOf: dir.appendingPathComponent(f.file))! }
let size = image(first).extent.size
let width = Int(size.width) & ~1, height = Int(size.height) & ~1

try? FileManager.default.removeItem(at: out)
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: bps,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
  ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let total = Int((last.t - first.t) * Double(fps)) + Int(fps) // one more second on the last frame
var index = 0
var current: CIImage = image(first)
let space = CGColorSpaceCreateDeviceRGB()
for n in 0..<total {
  let t = first.t + Double(n) / Double(fps)
  var advanced = false
  while index + 1 < frames.count && frames[index + 1].t <= t { index += 1; advanced = true }
  if advanced { current = image(frames[index]) }
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  var buffer: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
  context.render(current, to: buffer!, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: space)
  adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { print("failed: \(String(describing: writer.error))"); exit(1) }
let bytes = (try FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
print("wrote \(out.path): \(width)x\(height), \(total) frames at \(fps) fps (\(String(format: "%.1f", Double(total) / Double(fps))) s), \(bytes) bytes")
