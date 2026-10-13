import json
import sys
import zlib

CTCAE = {
    "alanine aminotransferase increased": {
        "soc": "Investigations",
        "grades": {
            "1": ">ULN - 3.0 x ULN",
            "2": ">3.0 - 5.0 x ULN",
            "3": ">5.0 - 20.0 x ULN",
            "4": ">20.0 x ULN",
        },
    },
    "blood bilirubin increased": {
        "soc": "Investigations",
        "grades": {
            "1": ">ULN - 1.5 x ULN",
            "2": ">1.5 - 3.0 x ULN",
            "3": ">3.0 - 10.0 x ULN",
            "4": ">10.0 x ULN",
        },
    },
    "neutrophil count decreased": {
        "soc": "Investigations",
        "grades": {
            "1": "<LLN - 1500/mm3",
            "2": "<1500 - 1000/mm3",
            "3": "<1000 - 500/mm3",
            "4": "<500/mm3",
        },
    },
    "febrile neutropenia": {
        "soc": "Blood and lymphatic system disorders",
        "grades": {
            "3": "ANC <1000/mm3 with a single temperature of >38.3 C or sustained >=38 C for more than one hour",
            "4": "Life-threatening consequences; urgent intervention indicated",
            "5": "Death",
        },
    },
    "nausea": {
        "soc": "Gastrointestinal disorders",
        "grades": {
            "1": "Loss of appetite without alteration in eating habits",
            "2": "Oral intake decreased without significant weight loss, dehydration or malnutrition",
            "3": "Inadequate oral caloric or fluid intake; tube feeding, TPN, or hospitalization indicated",
        },
    },
    "diarrhea": {
        "soc": "Gastrointestinal disorders",
        "grades": {
            "1": "Increase of <4 stools per day over baseline",
            "2": "Increase of 4 - 6 stools per day over baseline; limiting instrumental ADL",
            "3": "Increase of >=7 stools per day over baseline; hospitalization indicated; limiting self care ADL",
            "4": "Life-threatening consequences; urgent intervention indicated",
            "5": "Death",
        },
    },
    "rash maculo-papular": {
        "soc": "Skin and subcutaneous tissue disorders",
        "grades": {
            "1": "Macules/papules covering <10% BSA",
            "2": "Macules/papules covering 10 - 30% BSA",
            "3": "Macules/papules covering >30% BSA; limiting self care ADL",
        },
    },
    "pneumonitis": {
        "soc": "Respiratory, thoracic and mediastinal disorders",
        "grades": {
            "1": "Asymptomatic; clinical or diagnostic observations only",
            "2": "Symptomatic; medical intervention indicated; limiting instrumental ADL",
            "3": "Severe symptoms; limiting self care ADL; oxygen indicated",
            "4": "Life-threatening respiratory compromise; urgent intervention indicated",
            "5": "Death",
        },
    },
}

REFERENCE_RANGES = {
    "ALT": {"unit": "U/L", "lower": 7, "upper": 56},
    "AST": {"unit": "U/L", "lower": 10, "upper": 40},
    "BILIRUBIN": {"unit": "mg/dL", "lower": 0.1, "upper": 1.2},
    "ALP": {"unit": "U/L", "lower": 44, "upper": 147},
    "ANC": {"unit": "/mm3", "lower": 1500, "upper": 8000},
}

TOOLS = [
    {
        "name": "list_ctcae_terms",
        "description": "List the CTCAE v5.0 terms this reference covers.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "lookup_ctcae_term",
        "description": "Return the CTCAE v5.0 grade definitions for one adverse event term.",
        "inputSchema": {
            "type": "object",
            "properties": {"term": {"type": "string", "description": "CTCAE term, e.g. 'Alanine aminotransferase increased'"}},
            "required": ["term"],
        },
    },
    {
        "name": "get_reference_range",
        "description": "Return the lab reference range (lower and upper limit of normal) for an analyte: ALT, AST, BILIRUBIN, ALP or ANC.",
        "inputSchema": {
            "type": "object",
            "properties": {"analyte": {"type": "string"}},
            "required": ["analyte"],
        },
    },
    {
        "name": "file_safety_report",
        "description": "File an expedited safety report with the pharmacovigilance desk. Side effect: creates a report. Use only for a serious event of grade 3 or higher.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "subjectId": {"type": "string"},
                "term": {"type": "string"},
                "grade": {"type": "integer"},
            },
            "required": ["subjectId", "term", "grade"],
        },
    },
]


def call_tool(name: str, arguments: dict) -> tuple[str, bool]:
    if name == "list_ctcae_terms":
        return json.dumps(sorted(CTCAE.keys())), False
    if name == "lookup_ctcae_term":
        term = str(arguments.get("term", "")).strip().lower()
        entry = CTCAE.get(term)
        if entry is None:
            return f"Unknown CTCAE term '{arguments.get('term')}'. Call list_ctcae_terms for the covered terms.", True
        return json.dumps({"term": term, **entry}), False
    if name == "get_reference_range":
        analyte = str(arguments.get("analyte", "")).strip().upper()
        reference = REFERENCE_RANGES.get(analyte)
        if reference is None:
            return f"No reference range for '{arguments.get('analyte')}'. Known: {', '.join(REFERENCE_RANGES)}.", True
        return json.dumps({"analyte": analyte, **reference}), False
    if name == "file_safety_report":
        report_id = f"SR-{zlib.crc32(f"{arguments.get('subjectId')}|{arguments.get('term')}".encode()) % 100000:05d}"
        return json.dumps({"reportId": report_id, "status": "filed"}), False
    return f"Unknown tool '{name}'", True


def respond(message_id: object, result: dict | None = None, error: dict | None = None) -> None:
    payload: dict = {"jsonrpc": "2.0", "id": message_id}
    if error is not None:
        payload["error"] = error
    else:
        payload["result"] = result
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def handle(message: dict) -> None:
    method = message.get("method")
    message_id = message.get("id")
    if message_id is None:
        return
    params = message.get("params") or {}
    if method == "initialize":
        respond(message_id, {
            "protocolVersion": params.get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "ctcae-reference", "version": "1.0.0"},
        })
    elif method == "ping":
        respond(message_id, {})
    elif method == "tools/list":
        respond(message_id, {"tools": TOOLS})
    elif method == "tools/call":
        text, is_error = call_tool(params.get("name", ""), params.get("arguments") or {})
        respond(message_id, {"content": [{"type": "text", "text": text}], "isError": is_error})
    else:
        respond(message_id, error={"code": -32601, "message": f"Method not found: {method}"})


for line in sys.stdin:
    line = line.strip()
    if line == "":
        continue
    try:
        handle(json.loads(line))
    except json.JSONDecodeError:
        continue
