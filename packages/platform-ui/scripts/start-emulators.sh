#!/bin/bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.10/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
exec firebase emulators:start --project demo-mediforce --only auth,firestore "$@"
