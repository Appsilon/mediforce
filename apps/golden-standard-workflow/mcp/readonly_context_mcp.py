"""Example stdio MCP executable placeholder.

Production MCP servers should implement the MCP protocol. This file exists so
the Dockerfile demonstrates where workflow-owned MCP executables live and what
command a Tool Catalog entry would point at.
"""

import json
import os
import sys


def main() -> None:
    token_present = os.environ.get('CONTEXT_TOKEN') is not None
    sys.stdout.write(json.dumps({'status': 'ready', 'tokenPresent': token_present}))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
