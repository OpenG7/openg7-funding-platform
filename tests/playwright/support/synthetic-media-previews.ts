import sharp from 'sharp';

const landscapes = [
  `<rect width="960" height="640" fill="#f5e8c8"/><circle cx="745" cy="142" r="76" fill="#e8ac40"/><path d="M0 420 252 128 502 420Z" fill="#668b86"/><path d="m210 420 350-292 400 292Z" fill="#315d69"/><path d="m398 264 162-136 186 136-92-24-94 56-78-45Z" fill="#fff2cf"/><path d="M0 414h960v226H0z" fill="#79b7bc"/><path d="M0 499q240-80 490 8t470-4v137H0Z" fill="#c89562"/><path d="m81 549 58-145 58 145Zm89 48 70-188 70 188Zm584-23 65-191 65 191Z" fill="#294f50"/>`,
  `<rect width="960" height="640" fill="#d5eaf0"/><circle cx="168" cy="134" r="72" fill="#efb34e"/><path d="M0 435Q170 200 350 370T960 330v310H0Z" fill="#77916f"/><path d="M0 475q235-180 480 4t480-12v173H0Z" fill="#315e55"/><path d="M470 640q-90-110 60-185t70-94q145 65 28 147t-36 132Z" fill="#80bdcc"/><path d="M90 570V302m0 80-40-37m40 78 50-51m660 232V257m0 98-58-47m58 108 62-66" stroke="#303e3a" stroke-width="15" stroke-linecap="round"/><circle cx="90" cy="296" r="88" fill="#d7844e"/><circle cx="750" cy="252" r="108" fill="#d7aa4c"/>`,
  `<rect width="960" height="640" fill="#283b63"/><circle cx="758" cy="143" r="68" fill="#f0d28f"/><path d="M0 540V276h155v264Zm135 0V168h178v372Zm166 0V322h170v218Zm160 0V223h192v317Zm180 0V348h174v192Zm164 0V259h155v281Z" fill="#49678b"/><path d="M167 209h31v41h-31Zm65 0h31v41h-31Zm-65 77h31v41h-31Zm65 0h31v41h-31Zm261-18h37v49h-37Zm76 0h37v49h-37Zm-76 91h37v49h-37Zm76 0h37v49h-37ZM28 330h38v49H28Zm71 0h38v49H99Zm742-20h35v42h-35Zm0 88h35v42h-35Z" fill="#edc66e"/><path d="M0 546q245-75 480 5t480-5v94H0Z" fill="#507a69"/><path d="M0 605h960" stroke="#dda768" stroke-width="23"/>`
] as const;
const cached = new Map<number, Promise<Buffer>>();

/** Recognizable geometric scenes only; no client photograph or external request. */
export function syntheticMediaPreview(assetId: string): Promise<Buffer> {
  const index =
    [...assetId].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
    landscapes.length;
  let preview = cached.get(index);
  if (!preview) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">${landscapes[index]}<rect x="24" y="24" width="190" height="38" rx="8" fill="#fff5dc"/><text x="40" y="50" font-family="sans-serif" font-size="20" font-weight="600" fill="#25364c">SYNTHETIC · ${index + 1}</text></svg>`;
    preview = sharp(Buffer.from(svg)).png().toBuffer();
    cached.set(index, preview);
  }
  return preview;
}
