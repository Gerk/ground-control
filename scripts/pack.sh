#!/bin/sh
# Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
# Build Ground-Control.lunaaddon from only the files the Add On loads. `ua-builder pack` on the
# repo root would also take the luna-builder-sdk/ submodule (with its node_modules).
set -e
cd "$(dirname "$0")/.."
rm -rf build && mkdir -p "build/Ground Control/vendor"
cp index.html logic.js main.js manifest.json LICENSE NOTICE README.md "build/Ground Control/"
cp vendor/luna.global.js vendor/LICENSE vendor/NOTICE "build/Ground Control/vendor/"
npx ua-builder pack "build/Ground Control" --no-vendor --out Ground-Control.lunaaddon
rm -rf build
unzip -l Ground-Control.lunaaddon
