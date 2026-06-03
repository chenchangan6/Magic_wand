#!/bin/sh
cd "$(dirname "$0")"
export MAGIC_START_PATH="/flash.html"
sh ./serve_macos.sh
