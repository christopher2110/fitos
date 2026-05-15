#!/usr/bin/env python3
"""
FitOS Sheet Builder
===================
Creates a fully-formed FitOS client sheet in a coach's Google Drive by reading
schemas/sheet_schema.json declaratively.  Run once per client onboarding.

Single-tenant architecture: runs in the coach's own Google Cloud project.
No Polsia-specific dependencies.  No Postgres.  Sheet is canonical state.

Usage:
    python fitos_sheet_builder.py --coach-email coach@example.com [--client-name "Jane Doe"] [--schema ../schemas/sheet_schema.json]

Requirements:
    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

OAuth token is cached in ~/.fitos_token.json after the first browser flow.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency guard — friendly error before cryptic ImportError
# ---------------------------------------------------------------------------
try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
except ImportError:
    print(
        "\n[ERROR] Google API client libraries not found.\n"
        "Install them with:\n"
        "    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib\n"
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]
TOKEN_PATH = Path.home() / ".fitos_token.json"

# Colour → RGB integer helper
_HEX_CACHE: dict = {}


def hex_to_rgb(hex_color: str) -> dict:
    """Convert #RRGGBB to the {red, green, blue} dict Google Sheets API expects (0-1 floats)."""
    h = hex_color.lstrip("#")
    if h not in _HEX_CACHE:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        _HEX_CACHE[h] = {"red": r / 255, "green": g / 255, "blue": b / 255}
    return _HEX_CACHE[h]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_credentials(credentials_file: str) -> Credentials:
    """Return valid OAuth credentials, refreshing or running the browser flow as needed."""
    creds = None

    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("[auth] Refreshing expired token …")
            creds.refresh(Request())
        else:
            print(f"[auth] Opening browser OAuth flow (credentials: {credentials_file}) …")
            flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
            creds = flow.run_local_server(port=0)

        # Persist token for subsequent runs
        TOKEN_PATH.write_text(creds.to_json())
        print(f"[auth] Token cached at {TOKEN_PATH}")

    return creds


# ---------------------------------------------------------------------------
# Sheet creation helpers
# ---------------------------------------------------------------------------

def create_spreadsheet(sheets_svc, title: str) -> str:
    """Create a new Spreadsheet with a single placeholder sheet and return the spreadsheetId."""
    body = {"properties": {"title": title}}
    resp = sheets_svc.spreadsheets().create(body=body, fields="spreadsheetId").execute()
    sheet_id = resp["spreadsheetId"]
    print(f"[create] Spreadsheet created: {sheet_id}")
    return sheet_id


def share_spreadsheet(drive_svc, spreadsheet_id: str, coach_email: str) -> str:
    """Grant the coach 'owner' role and return the web view URL."""
    drive_svc.permissions().create(
        fileId=spreadsheet_id,
        body={"type": "user", "role": "owner", "emailAddress": coach_email},
        transferOwnership=True,
    ).execute()
    file_meta = drive_svc.files().get(
        fileId=spreadsheet_id, fields="webViewLink"
    ).execute()
    return file_meta.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}")


def add_sheets_batch(sheets_svc, spreadsheet_id: str, tabs: list) -> dict:
    """
    Add all tab sheets in a single batchUpdate.  Returns map of tab_name → sheetId.
    The first sheet in the response is the one Google auto-creates on spreadsheet creation.
    We rename that one to the first tab and add the rest.
    """
    # Fetch existing sheets so we can rename/delete the default "Sheet1"
    meta = sheets_svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = meta.get("sheets", [])
    default_sheet_id = existing[0]["properties"]["sheetId"] if existing else None

    requests = []

    for i, tab in enumerate(tabs):
        tab_color_rgb = hex_to_rgb(tab.get("tab_color", "#FFFFFF"))

        if i == 0 and default_sheet_id is not None:
            # Rename the default sheet
            requests.append({
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": default_sheet_id,
                        "title": tab["name"],
                        "index": 0,
                        "tabColor": tab_color_rgb,
                    },
                    "fields": "title,index,tabColor",
                }
            })
        else:
            requests.append({
                "addSheet": {
                    "properties": {
                        "title": tab["name"],
                        "index": i,
                        "tabColor": tab_color_rgb,
                    }
                }
            })

    result = sheets_svc.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests}
    ).execute()

    # Build name → sheetId map from result
    name_to_id: dict = {}
    if default_sheet_id is not None:
        name_to_id[tabs[0]["name"]] = default_sheet_id

    for reply in result.get("replies", []):
        props = reply.get("addSheet", {}).get("properties", {})
        if props.get("title"):
            name_to_id[props["title"]] = props["sheetId"]

    # Verify we have every tab
    if len(name_to_id) != len(tabs):
        # Fallback: re-fetch
        meta2 = sheets_svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        for s in meta2.get("sheets", []):
            name_to_id[s["properties"]["title"]] = s["properties"]["sheetId"]

    return name_to_id


# ---------------------------------------------------------------------------
# Column / header helpers
# ---------------------------------------------------------------------------

def write_headers_and_data(sheets_svc, spreadsheet_id: str, tab: dict, name_to_id: dict) -> list:
    """
    Write headers row + starter data rows to a tab.
    Returns (requests list for batchUpdate — formatting, not values).
    Uses values.batchUpdate for the actual cell values.
    """
    sheet_name = tab["name"]
    columns = tab.get("columns", [])
    rows_data = tab.get("rows", [])

    if not columns:
        return []

    col_names = [c["name"] for c in columns]

    # Build value matrix: header row + data rows
    matrix = [col_names]
    for row_dict in rows_data:
        row_values = [row_dict.get(c, "") for c in col_names]
        # Convert booleans to string for Sheets
        row_values = ["TRUE" if v is True else "FALSE" if v is False else v for v in row_values]
        matrix.append(row_values)

    end_col_letter = _col_letter(len(col_names))
    range_name = f"'{sheet_name}'!A1:{end_col_letter}{len(matrix)}"

    sheets_svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        body={"values": matrix},
    ).execute()

    print(f"  [data] {sheet_name}: {len(col_names)} columns, {len(rows_data)} example rows written")
    return []


def _col_letter(n: int) -> str:
    """Convert 1-based column index to A1 column letter (A, B, … Z, AA, AB …)."""
    result = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return result


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def build_formatting_requests(tab: dict, sheet_id: int) -> list:
    """
    Return a list of Sheets API request dicts for:
    - Header row bold + fill (olive)
    - Freeze rows
    - Column widths
    - Data validation
    - Conditional formatting (RPE scale, status badges, compliance bar)
    """
    requests = []
    columns = tab.get("columns", [])
    num_cols = len(columns)
    freeze_rows = tab.get("freeze_rows", 1)

    if not columns:
        return requests

    # ---- 1. Freeze rows ----
    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "gridProperties": {"frozenRowCount": freeze_rows},
            },
            "fields": "gridProperties.frozenRowCount",
        }
    })

    # ---- 2. Header row bold + cream background + olive text ----
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1,
                      "startColumnIndex": 0, "endColumnIndex": num_cols},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": hex_to_rgb("#5C6833"),
                    "textFormat": {
                        "bold": True,
                        "foregroundColor": hex_to_rgb("#FAF6EE"),
                        "fontSize": 10,
                    },
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE",
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        }
    })

    # ---- 3. Data rows alternating subtle fill ----
    requests.append({
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [{"sheetId": sheet_id, "startRowIndex": 1}],
                "booleanRule": {
                    "condition": {"type": "CUSTOM_FORMULA",
                                  "values": [{"userEnteredValue": "=ISEVEN(ROW())"}]},
                    "format": {"backgroundColor": hex_to_rgb("#F5F0E8")},
                }
            },
            "index": 0,
        }
    })

    # ---- 4. Column widths ----
    for col_idx, col in enumerate(columns):
        width_px = col.get("width", 120)
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": col_idx,
                    "endIndex": col_idx + 1,
                },
                "properties": {"pixelSize": width_px},
                "fields": "pixelSize",
            }
        })

    # ---- 5. Data validation ----
    for col_idx, col in enumerate(columns):
        validation = col.get("validation")
        if not validation:
            continue
        vtype = validation.get("type")

        dv_rule = None
        if vtype == "dropdown":
            dv_rule = {
                "condition": {
                    "type": "ONE_OF_LIST",
                    "values": [{"userEnteredValue": v} for v in validation["values"]],
                },
                "showCustomUi": True,
                "strict": False,
            }
        elif vtype == "integer":
            dv_rule = {
                "condition": {
                    "type": "NUMBER_BETWEEN",
                    "values": [
                        {"userEnteredValue": str(validation.get("min", 0))},
                        {"userEnteredValue": str(validation.get("max", 9999))},
                    ],
                },
                "inputMessage": f"Enter {col['name']} ({validation.get('min', 0)}–{validation.get('max', 9999)})",
                "strict": False,
            }
        elif vtype == "number":
            dv_rule = {
                "condition": {
                    "type": "NUMBER_BETWEEN",
                    "values": [
                        {"userEnteredValue": str(validation.get("min", 0))},
                        {"userEnteredValue": str(validation.get("max", 9999))},
                    ],
                },
                "strict": False,
            }
        elif vtype == "date":
            dv_rule = {
                "condition": {"type": "DATE_IS_VALID"},
                "inputMessage": "Enter date as YYYY-MM-DD",
                "strict": False,
            }

        if dv_rule:
            requests.append({
                "setDataValidation": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "startColumnIndex": col_idx,
                        "endColumnIndex": col_idx + 1,
                    },
                    "rule": dv_rule,
                }
            })

    # ---- 6. Conditional formatting ----
    tab_cfs = tab.get("conditional_formats", {})

    for col_idx, col in enumerate(columns):
        cf_key = col.get("conditional_format")
        if not cf_key or cf_key not in tab_cfs:
            continue

        cf_def = tab_cfs[cf_key]
        rules = cf_def.get("rules", [])

        for rule in rules:
            # Numeric gradient range
            if "min" in rule and "max" in rule:
                requests.append({
                    "addConditionalFormatRule": {
                        "rule": {
                            "ranges": [{
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": col_idx,
                                "endColumnIndex": col_idx + 1,
                            }],
                            "booleanRule": {
                                "condition": {
                                    "type": "NUMBER_BETWEEN",
                                    "values": [
                                        {"userEnteredValue": str(rule["min"])},
                                        {"userEnteredValue": str(rule["max"])},
                                    ],
                                },
                                "format": {
                                    "backgroundColor": hex_to_rgb(rule.get("background", "#FFFFFF")),
                                    "textFormat": {
                                        "foregroundColor": hex_to_rgb(rule.get("text", "#000000"))
                                    },
                                },
                            }
                        },
                        "index": 0,
                    }
                })
            # Exact-value badge
            elif "value" in rule:
                requests.append({
                    "addConditionalFormatRule": {
                        "rule": {
                            "ranges": [{
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": col_idx,
                                "endColumnIndex": col_idx + 1,
                            }],
                            "booleanRule": {
                                "condition": {
                                    "type": "TEXT_EQ",
                                    "values": [{"userEnteredValue": rule["value"]}],
                                },
                                "format": {
                                    "backgroundColor": hex_to_rgb(rule.get("background", "#FFFFFF")),
                                    "textFormat": {
                                        "foregroundColor": hex_to_rgb(rule.get("text", "#000000")),
                                        "bold": True,
                                    },
                                },
                            }
                        },
                        "index": 0,
                    }
                })

    return requests


# ---------------------------------------------------------------------------
# Named ranges
# ---------------------------------------------------------------------------

def build_named_range_requests(tab: dict, sheet_id: int) -> list:
    """Create named range requests from the schema's named_ranges list."""
    requests = []
    for nr in tab.get("named_ranges", []):
        name = nr.get("name")
        if not name:
            continue

        # Single-cell form: {name, row, col} (1-based)
        if "row" in nr and "col" in nr:
            r, c = nr["row"], nr["col"]
            requests.append({
                "addNamedRange": {
                    "namedRange": {
                        "name": name,
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": r - 1, "endRowIndex": r,
                            "startColumnIndex": c - 1, "endColumnIndex": c,
                        }
                    }
                }
            })
        # Block form: {name, row_start, col_start, row_end, col_end} (1-based)
        elif "row_start" in nr:
            requests.append({
                "addNamedRange": {
                    "namedRange": {
                        "name": name,
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": nr["row_start"] - 1,
                            "endRowIndex": nr["row_end"],
                            "startColumnIndex": nr["col_start"] - 1,
                            "endColumnIndex": nr["col_end"],
                        }
                    }
                }
            })

    return requests


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build_client_sheet(
    coach_email: str,
    client_name: str,
    schema_path: str,
    credentials_file: str,
) -> str:
    """
    End-to-end: create Sheet → apply schema → share → return URL.
    Returns the Google Sheets share URL.
    """
    # 1. Load schema
    schema_file = Path(schema_path)
    if not schema_file.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")

    with open(schema_file) as f:
        schema = json.load(f)

    tabs = schema.get("tabs", [])
    if not tabs:
        raise ValueError("Schema has no tabs defined.")

    print(f"\n[schema] Loaded {len(tabs)} tabs from {schema_path}")
    for tab in tabs:
        print(f"  • {tab['name']} ({len(tab.get('columns', []))} columns, {len(tab.get('rows', []))} example rows)")

    # 2. Authenticate
    creds = get_credentials(credentials_file)
    sheets_svc = build("sheets", "v4", credentials=creds)
    drive_svc = build("drive", "v3", credentials=creds)

    # 3. Create spreadsheet
    title = f"FitOS — {client_name}"
    spreadsheet_id = create_spreadsheet(sheets_svc, title)

    # 4. Add all tab sheets
    print("\n[tabs] Creating tab sheets …")
    name_to_id = add_sheets_batch(sheets_svc, spreadsheet_id, tabs)
    print(f"[tabs] {len(name_to_id)} tabs ready: {', '.join(name_to_id.keys())}")

    # 5. Write headers + data rows (values API)
    print("\n[data] Writing headers and example rows …")
    for tab in tabs:
        write_headers_and_data(sheets_svc, spreadsheet_id, tab, name_to_id)

    # 6. Apply formatting, validation, conditional rules, named ranges
    print("\n[format] Applying formatting and validation …")
    all_requests = []

    for tab in tabs:
        sheet_id = name_to_id.get(tab["name"])
        if sheet_id is None:
            print(f"  [WARN] Could not find sheetId for tab '{tab['name']}', skipping format.")
            continue

        all_requests.extend(build_formatting_requests(tab, sheet_id))
        all_requests.extend(build_named_range_requests(tab, sheet_id))

    # Chunk into batches of 100 requests (API limit per call is 500 but we're conservative)
    CHUNK = 100
    for i in range(0, len(all_requests), CHUNK):
        chunk = all_requests[i:i + CHUNK]
        sheets_svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": chunk},
        ).execute()
        print(f"  [format] Applied requests {i + 1}–{min(i + CHUNK, len(all_requests))} of {len(all_requests)}")

    # 7. Share with coach
    print(f"\n[share] Sharing sheet with {coach_email} …")
    url = share_spreadsheet(drive_svc, spreadsheet_id, coach_email)

    return spreadsheet_id, url


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="FitOS Sheet Builder — creates a fully-formed client sheet in Google Sheets."
    )
    parser.add_argument(
        "--coach-email", required=True,
        help="Google account email of the coach. The sheet is shared to this account."
    )
    parser.add_argument(
        "--client-name", default="New Client",
        help="Client's full name (used as sheet title). Default: 'New Client'."
    )
    parser.add_argument(
        "--schema",
        default=str(Path(__file__).parent.parent / "schemas" / "sheet_schema.json"),
        help="Path to sheet_schema.json. Default: ../schemas/sheet_schema.json"
    )
    parser.add_argument(
        "--credentials",
        default=str(Path.home() / "fitos_credentials.json"),
        help="Path to Google OAuth credentials JSON from Google Cloud Console. Default: ~/fitos_credentials.json"
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if not Path(args.credentials).exists():
        print(
            f"\n[ERROR] OAuth credentials file not found: {args.credentials}\n\n"
            "How to get it:\n"
            "  1. Go to https://console.cloud.google.com/\n"
            "  2. Create a project (or select one).\n"
            "  3. Enable the Google Sheets API and Google Drive API.\n"
            "  4. Go to APIs & Services → Credentials → Create Credentials → OAuth client ID.\n"
            "  5. Application type: Desktop app.\n"
            "  6. Download the JSON and save it to ~/fitos_credentials.json\n"
            "     (or pass --credentials /path/to/credentials.json)\n\n"
            "Scopes required:\n"
            "  • https://www.googleapis.com/auth/spreadsheets\n"
            "  • https://www.googleapis.com/auth/drive.file\n"
        )
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  FitOS Sheet Builder")
    print(f"  Coach email : {args.coach_email}")
    print(f"  Client name : {args.client_name}")
    print(f"  Schema      : {args.schema}")
    print(f"{'='*60}\n")

    try:
        sheet_id, url = build_client_sheet(
            coach_email=args.coach_email,
            client_name=args.client_name,
            schema_path=args.schema,
            credentials_file=args.credentials,
        )
    except Exception as e:
        print(f"\n[FATAL] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  ✓  Sheet created successfully!")
    print(f"  Sheet ID  : {sheet_id}")
    print(f"  Share URL : {url}")
    print(f"{'='*60}\n")
    print("Next steps:")
    print("  1. Open the URL above and verify each tab looks correct.")
    print("  2. Update the Profile tab with your client's real data.")
    print("  3. Paste the Sheet ID into your PWA / dashboard config.")
    print(f"  4. Token cached at ~/.fitos_token.json — runs silently from now on.\n")


if __name__ == "__main__":
    main()
