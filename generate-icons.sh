#!/bin/bash
# Generate Chrome extension icons from logo.PNG

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Install it with:"
    echo "  sudo apt install imagemagick  # Ubuntu/Debian"
    echo "  brew install imagemagick       # macOS"
    exit 1
fi

# Create icons directory
mkdir -p icons

# Generate icons at different sizes
echo "Generating extension icons..."
convert logo.PNG -resize 16x16 icons/icon-16.png
convert logo.PNG -resize 32x32 icons/icon-32.png
convert logo.PNG -resize 48x48 icons/icon-48.png
convert logo.PNG -resize 128x128 icons/icon-128.png

echo "Icons generated in ./icons/"
echo "Update manifest.json to point to these icon files."
