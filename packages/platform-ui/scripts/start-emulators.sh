#!/bin/bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.10/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

PORTS=(9099 8080 4000)
blocked=()

kill_port() {
  fuser -k "$1/tcp" 2>/dev/null || lsof -ti ":$1" 2>/dev/null | xargs kill -9 2>/dev/null
}

for port in "${PORTS[@]}"; do
  if fuser "$port/tcp" 2>/dev/null || lsof -ti ":$port" >/dev/null 2>&1; then
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
    kill_port "$port"
  done
  echo "Ports freed."
fi

exec firebase emulators:start --project demo-mediforce --only auth,firestore "$@"
