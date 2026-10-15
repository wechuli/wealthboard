import {
  SourceExtractionError,
  type Bytes,
} from "@/lib/source-extraction/source";

const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const names = new TextDecoder();

const corrupt = () =>
  new SourceExtractionError("The document archive is corrupt or encrypted.");
const unreadable = () =>
  new SourceExtractionError("The document archive could not be read.");
const unsupported = () =>
  new SourceExtractionError(
    "The document archive is encrypted, oversized, or unsupported.",
  );
const oversized = () =>
  new SourceExtractionError("The expanded document exceeds 20 MB.");

async function inflate(data: Bytes, limit: number): Promise<Bytes> {
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw oversized();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SourceExtractionError) throw error;
    throw unreadable();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

// Reads a ZIP archive from memory, rejecting encryption, ZIP64, multi-disk
// archives, path traversal, duplicate names, more than 2,000 entries, and more
// than 20 MB of expanded content.
export async function readZip(bytes: Bytes): Promise<Map<string, Bytes>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 22 - 0xffff);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw corrupt();
  const entryCount = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== entryCount ||
    entryCount === 0xffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize > end
  )
    throw corrupt();

  const entries = new Map<string, Bytes>();
  let expanded = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > end ||
      view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY
    )
      throw corrupt();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength > end) throw corrupt();
    const name = names.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) {
      throw new SourceExtractionError(
        "Encrypted Office ZIP entries are unsupported. Open the document in its original application and export an unencrypted XLSX, DOCX, or CSV copy.",
        "unsupported_encrypted_archive",
      );
    }
    if (
      index + 1 > MAX_ENTRIES ||
      size > MAX_EXPANDED_BYTES ||
      entries.has(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      throw unsupported();
    if (name.endsWith("/")) continue;

    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER
    )
      throw unreadable();
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) throw unreadable();
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    let content: Bytes;
    if (method === 0) {
      if (expanded + data.length > MAX_EXPANDED_BYTES) throw oversized();
      content = data;
    } else if (method === 8) {
      content = await inflate(data, MAX_EXPANDED_BYTES - expanded);
    } else {
      throw unsupported();
    }
    if (content.length !== size) throw unreadable();
    expanded += content.length;
    entries.set(name, content);
  }
  return entries;
}
