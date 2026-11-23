#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
cargo build -p kertas-wasm --release --target wasm32-unknown-unknown
mkdir -p dist
cp target/wasm32-unknown-unknown/release/kertas_wasm.wasm dist/kertas.wasm
ls -l dist/kertas.wasm
