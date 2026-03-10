#!/bin/bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.10/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

PORTS=(9099 8080 4000)
blocked=()

for port in "${PORTS[@]}"; do
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    blocked+=("$port")
  fi
done

if [ ${#blocked[@]} -gt 0 ]; then
  echo "Ports already in use: ${blocked[*]}"
  read -r -p "Kill processes on these ports? [Y/n] " answer
  if [[ "$answer" =~ ^[Nn] ]]; then
    echo "Aborting. Free the ports manually and try again."
    exit 1
  fi
  for port in "${blocked[@]}"; do
    lsof -ti ":$port" 2>/dev/null | xargs kill -9 2>/dev/null
  done
  echo "Ports freed."
fi

exec firebase emulators:start --project demo-mediforce --only auth,firestore "$@"
