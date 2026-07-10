"use client";

export type ZipFileEntry = {
  path: string;
  blob: Blob;
  modifiedAt?: Date;
};

const textEncoder = new TextEncoder();
const crcTable = buildCrcTable();

export async function createZip(files: ZipFileEntry[]): Promise<Blob> {
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const pathBytes = textEncoder.encode(safeZipPath(file.path));
    const crc = crc32(data);
    const { dosDate, dosTime } = toDosDateTime(file.modifiedAt ?? new Date());
    const localHeader = new ArrayBuffer(30);
    const local = new DataView(localHeader);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, pathBytes.byteLength, true);
    local.setUint16(28, 0, true);
    localParts.push(localHeader, pathBytes, data);

    const centralHeader = new ArrayBuffer(46);
    const central = new DataView(centralHeader);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, pathBytes.byteLength, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralParts.push(centralHeader, pathBytes);

    offset += localHeader.byteLength + pathBytes.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  const centralBlob = new Blob(centralParts);
  const centralSize = centralBlob.size;
  const endHeader = new ArrayBuffer(22);
  const end = new DataView(endHeader);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);
  end.setUint16(20, 0, true);

  return new Blob([...localParts, centralBlob, endHeader], { type: "application/zip" });
}

function safeZipPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\./g, "_");
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}
