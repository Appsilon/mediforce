import json
import os
from pathlib import Path


INPUT_FILE = Path('/output/input.json')
RESULT_FILE = Path('/output/result.json')


def main() -> None:
    payload = json.loads(INPUT_FILE.read_text())
    intake = payload.get('steps', {}).get('collect-intake', {})

    priority = intake.get('priority', 'normal')
    route = 'collaborative' if priority == 'complex' else 'standard'

    result = {
        'studyId': intake.get('studyId', 'UNKNOWN'),
        'ownerEmail': intake.get('ownerEmail'),
        'priority': priority,
        'route': route,
        'appBaseUrl': os.environ.get('APP_BASE_URL', ''),
        'summary': f"Normalized intake for {intake.get('studyId', 'UNKNOWN')}.",
    }

    RESULT_FILE.write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
