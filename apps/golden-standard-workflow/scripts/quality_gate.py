import json
from pathlib import Path


INPUT_FILE = Path('/output/input.json')
RESULT_FILE = Path('/output/result.json')


def main() -> None:
    payload = json.loads(INPUT_FILE.read_text())
    normalized = payload.get('steps', {}).get('normalize-request', {})
    cowork_notes = payload.get('steps', {}).get('cowork-refine', {})

    missing = [
        name
        for name in ['studyId', 'ownerEmail']
        if not normalized.get(name)
    ]

    needs_agent_review = normalized.get('priority') in {'high', 'complex'} or bool(cowork_notes)

    result = {
        'passed': len(missing) == 0,
        'missing': missing,
        'needsAgentReview': needs_agent_review,
        'summary': 'Quality gate passed.' if len(missing) == 0 else f"Missing: {', '.join(missing)}",
    }

    RESULT_FILE.write_text(json.dumps(result, indent=2))
    if missing:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
