#!/bin/bash
cd "$(dirname "$0")"
npm run build 2>/dev/null || true
node dist/index.js
