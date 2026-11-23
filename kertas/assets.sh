#!/usr/bin/env sh
set -eu
dest=$(cd "$1" && pwd)
cd "$(dirname "$0")"
cp dist/kertas.wasm "$dest/kertas.wasm"
for lang in fr en; do
  cp "node_modules/dictionary-$lang/index.aff" "$dest/dictionary-$lang.aff"
  cp "node_modules/dictionary-$lang/index.dic" "$dest/dictionary-$lang.dic"
done
