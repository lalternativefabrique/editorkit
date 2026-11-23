#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build -p kertas-ffi --release --target "$target"
done
rm -rf dist/Kertas.xcframework
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libkertas_ffi.a -headers crates/kertas-ffi/include \
  -library target/aarch64-apple-ios-sim/release/libkertas_ffi.a -headers crates/kertas-ffi/include \
  -output dist/Kertas.xcframework
module=../../apps/mobile/modules/kertas/ios
if [ -d "$module" ]; then
  rm -rf "$module/Kertas.xcframework"
  cp -R dist/Kertas.xcframework "$module/"
fi
ls dist/Kertas.xcframework
