# AI-assisted text-file import

An account's **Import** page offers **Formatted CSV / JSON** and **Convert with
AI**. Direct structured import and browser-only copyable prompts still work
without an AI provider.

## Supported sources

| Format     | Extraction                                               | Limitations                                                                   |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CSV / TSV  | UTF-8 table rows                                         | Original decimal text is preserved                                            |
| JSON / TXT | UTF-8 source text                                        | JSON is validated without rewriting its numbers                               |
| XLSX       | Sheet rows and original cell values                      | Cached formulas are not recalculated; macros/external references are rejected |
| PDF        | Selectable page text, with an optional document password | No OCR; table order and missing/image content require review                  |
| DOCX       | Body paragraphs and tables                               | Images, headers, footers, drawings, and text boxes may be excluded            |

Files are limited to **5 MB**. Extracted content is limited to **64 KB and 1,000
sections**. PDFs are limited to 100 pages, workbooks to 20 sheets, and expanded
Office archives to 20 MB/2,000 entries. Document extraction times out after
15 seconds. Scanned/image-only PDFs, PNG/JPEG, legacy DOC/XLS, encrypted Office
files/archives, and external document references are unsupported. Nothing is silently
truncated to fit these limits.

## Password-protected files

For a password-protected PDF, select the file and enter **PDF password (if
required)** before **Extract locally**. You can also try extraction first: a
missing or incorrect password produces a distinct error and focuses the password
field. Re-enter the password and retry without selecting the file again.
Passwords are case-sensitive and are passed through without trimming spaces.
The field accepts up to 1,024 characters.

The password is used only by PDF.js inside the isolated extraction worker. It is
not an AI API key or application login password. The API accepts it only in the
multipart extraction request, clears its request copy after extraction, and does
not include it in the response or provider request. The parser child has an empty
environment and stderr is discarded. A sidecar operator must preserve the same
no-log/no-storage boundary. Retries require re-entry; use HTTPS for remote
deployments.
Unlocking a PDF does not add OCR support or guarantee correct table extraction.

| Protection                                              | Current behavior                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PDF password to open                                    | Supported using the password you provide; missing/wrong passwords allow retry                        |
| XLSX/DOCX password to open                              | Separate Office encryption, currently unsupported; open in Excel/Word and export an unencrypted copy |
| Excel sheet/workbook locks or Word editing restrictions | Not file encryption; otherwise supported content can be read without an editing password             |
| CSV, TSV, JSON, TXT                                     | No native password encryption; decrypt any external wrapper before uploading                         |
| Password-protected ZIP/other archives                   | Unsupported; unpack locally and upload a supported document, not the archive                         |

An encrypted Office file can retain its `.xlsx` or `.docx` extension while using
a compound-file container instead of normal ZIP/XML. Wealthboard recognizes that
container as encrypted or legacy and returns export guidance rather than asking
for a PDF password. Renaming the file is not enough. Office decryption remains
future work and does not fall back to external services.

References: Microsoft's [Excel file protection](https://support.microsoft.com/en-us/office/protect-an-excel-file-7359d4ae-7213-4ac2-b058-f75e9311b599),
[Word password protection](https://support.microsoft.com/en-us/office/protect-a-document-with-a-password-05084cc3-300d-4c1a-8416-38d3e37d6826),
and [Office cryptography specification](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/).

## Provider configuration

Use **Settings > AI provider** to select the provider, endpoint, and model
identifier. Remembered keys require the deployment's
`AI_CREDENTIAL_ENCRYPTION_KEY`; otherwise enter a session-only key on the import
page. Keys are never part of the model prompt.

Generate a dedicated credential key with `openssl rand -base64 32`. It must be
canonical base64 for exactly 32 bytes and must not reuse `SESSION_SECRET` or an
OIDC secret. Keep it stable: changing it makes existing remembered credentials
undecryptable. Remembered keys use AES-256-GCM with the user's immutable ID as
associated data and are excluded from user exports.

OpenAI always resolves to `https://api.openai.com/v1`; DeepSeek resolves to
`https://api.deepseek.com`. A custom endpoint must exactly match a normalized
HTTP(S) base URL in the comma-separated `AI_ALLOWED_ENDPOINTS` environment
variable. URLs with credentials, query parameters, or fragments are rejected.
The host is DNS-resolved when settings are saved and before requests; private,
loopback, link-local, multicast, carrier-grade NAT, and other local ranges are
blocked. Provider redirects and environment proxy variables are not used.

OpenAI uses the Responses API with native structured output. DeepSeek and
operator-approved compatible endpoints must support text Chat Completions with
JSON output. PDF, spreadsheet, or Word support is not required of the model:
Wealthboard extracts text before submission. Model names are entered manually;
access and compatibility errors surface when conversion runs. Wealthboard never
silently substitutes a model or provider.

Review and conversion share the same monthly token budget and rate limits.
The monthly limit can be set between **10,000 and 100,000,000 tokens**; existing
saved limits and the 100,000-token form default are unchanged. Provider requests
use a **120-second (two-minute) timeout**, with no automatic retries. This does
not change the separate 15-second local document-extraction timeout.
Conversion reserves a conservative input estimate plus the configured maximum
output tokens. A failed call with unknown usage retains that reservation.
Increase the output-token limit or use a smaller source if the model response
is incomplete. Retrying is explicit and may incur another provider charge.

## Document extraction deployment

UTF-8 CSV, TSV, JSON, and TXT are parsed directly by the Go service. PDF, XLSX,
and DOCX require an isolated Node parser. On a direct installation, Wealthboard
uses `node` and `AI_EXTRACTION_SCRIPT` (default
`scripts/extract-import-source-cli.mjs`). The child receives no inherited
environment, has bounded memory/output, and is killed at the 15-second deadline.

The distroless application image contains neither Node nor parser dependencies.
Compose and the Kubernetes example run the repository's separate
`extraction-worker` image with no network and a shared in-memory Unix socket.
For each connection, the service writes one JSON
object containing `extension`, base64 `bytes`, and `documentPassword`, closes
its write side, and expects the same bounded JSON response produced by the CLI
script. The daemon caps connections, request/response sizes, parser memory, and
runtime; clears request buffers and its environment; suppresses worker output;
and creates its socket with restricted permissions. Custom deployments must
preserve those controls and keep the socket pod-local.
Without Node or a reachable sidecar, plain text/table extraction still works,
but PDF/XLSX/DOCX returns a bounded parser error.

## Workflow

1. Choose **Convert with AI**, select a source, and select **Extract locally**.
   Supply the PDF's document password if required. The file is processed inside
   your self-hosted Wealthboard instance, not sent to an external provider.
2. Review the extracted sections and warnings. Select relevant activity and
   redact sensitive text. Section labels and original filenames are not sent.
3. Check the destination/model, account context, source size, and output ceiling.
   Approve the sharing and possible charges, then select **Convert selected text**.
   Changing the text or selection clears consent. Saved credentials alone do
   not authorize sharing a statement.
4. Inspect the JSON draft, source references, exclusions, and validation issues.
   Correct ambiguous dates/currencies/identifiers or missing fields and
   acknowledge excluded activity. A source reference is not proof of accuracy.
5. Select **Use draft for preview**, then **Preview file**. Confirm only after
   reviewing the existing balance or investment preview. **Edit draft** discards
   that preview and requires another review/preview before confirmation.

The generated draft can also be downloaded for manual editing. Financial
records are changed only by the normal commit operation. Balance imports keep
their accepted-subset policy; investment imports retain all-or-nothing atomicity.
The existing canonical file limits remain 5 MB/10,000 records; an AI extraction
response is limited to 1,000 candidate records.

## Privacy and safety

Only approved text and minimal schema/account context go to the model. It has
no tools, database access, or authority to execute transactions. Source files,
extracted text, prompts, responses, and drafts are not logged or stored by
Wealthboard. In-memory content is cleared on cancel, completion, navigation, or
logout; document workers are terminated after use. Usage history contains
metadata only. Privacy mode hides source content and drafts.

Provider-side retention follows the provider's policies; local cleanup cannot
guarantee deletion there. Never assume selectable PDF text preserves table
columns or that all Word document content was extracted. Missing, ambiguous,
or unsupported activity must be resolved or explicitly excluded before import.
