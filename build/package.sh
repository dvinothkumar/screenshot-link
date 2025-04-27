#!/bin/bash

# exit if any of the intermediate steps fail
set -e

# Removed browser argument check, script now only builds for Chrome

# set current working directory to directory of the shell script
cd "$(dirname "$0")"

# cleanup
rm -rf ../vendor
rm -f ../screenshot-link.zip
mkdir -p ../vendor

# build deps
sh bootstrap/build.sh
sh jquery/build.sh
sh mdc/build.sh
sh mithril/build.sh

# copy files
mkdir -p tmp
mkdir -p tmp/screenshot-link
cd ..
cp -r background content icons options vendor LICENSE build/tmp/screenshot-link/

# Always copy the main manifest
cp manifest.json build/tmp/screenshot-link/manifest.json
# No longer need to copy manifest.chrome.json to the root

# Always archive for chrome (archive the screenshot-link folder itself)
cd build/tmp/
zip -r ../../screenshot-link.zip screenshot-link
cd ..

# cleanup
rm -rf tmp/
