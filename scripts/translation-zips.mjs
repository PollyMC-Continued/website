// Bundles every translation file into two zips so one URL can download them all:
//   /translation/sources/*.ts  ->  pollymc-translations-ts.zip
//   /translation/sources/*.qm  ->  pollymc-translations-qm.zip   (also /translation/*.qm)
// Runs after `astro build`, on whatever CI put in dist/translation. No dependencies.
// Usage: node scripts/translation-zips.mjs [outputDir]   (default: dist)
import { createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';
import { join } from 'node:path';

const root = process.argv[2] || 'dist';
const dir = join(root, 'translation');

const BUNDLES = [
	{ ext: '.ts', from: join(dir, 'sources'), out: join(dir, 'pollymc-translations-ts.zip') },
	{ ext: '.qm', from: dir, out: join(dir, 'pollymc-translations-qm.zip') },
];

function dosDateTime(d) {
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
	const date = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	return { time, date };
}

async function writeZip(files, out) {
	const stream = createWriteStream(out);
	const write = (buf) => new Promise((res, rej) => stream.write(buf, (e) => (e ? rej(e) : res())));
	const central = [];
	let offset = 0;

	for (const { name, path } of files) {
		const data = await readFile(path);
		const { mtime } = await stat(path);
		const { time, date } = dosDateTime(mtime);
		const packed = deflateRawSync(data, { level: 9 });
		const useDeflate = packed.length < data.length;
		const body = useDeflate ? packed : data;
		const method = useDeflate ? 8 : 0;
		const crc = crc32(data);
		const nameBuf = Buffer.from(name, 'utf8');

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		await write(local);
		await write(nameBuf);
		await write(body);

		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0);
		cen.writeUInt16LE(20, 4); // version made by
		cen.writeUInt16LE(20, 6); // version needed
		cen.writeUInt16LE(0x0800, 8);
		cen.writeUInt16LE(method, 10);
		cen.writeUInt16LE(time, 12);
		cen.writeUInt16LE(date, 14);
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(body.length, 20);
		cen.writeUInt32LE(data.length, 24);
		cen.writeUInt16LE(nameBuf.length, 28);
		cen.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cen, nameBuf]));

		offset += 30 + nameBuf.length + body.length;
	}

	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	await write(centralBuf);
	await write(end);
	await new Promise((res, rej) => stream.end((e) => (e ? rej(e) : res())));
}

for (const { ext, from, out } of BUNDLES) {
	let names = [];
	try {
		names = (await readdir(from, { withFileTypes: true }))
			.filter((e) => e.isFile() && e.name.endsWith(ext))
			.map((e) => e.name)
			.sort();
	} catch {
		// folder missing, handled below
	}
	if (!names.length) {
		console.warn(`[translation-zips] no ${ext} files in ${from}, skipping`);
		continue;
	}
	await writeZip(names.map((name) => ({ name, path: join(from, name) })), out);
	const { size } = await stat(out);
	console.log(`[translation-zips] ${out}: ${names.length} files, ${(size / 1048576).toFixed(1)} MB`);
}
