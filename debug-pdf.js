import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';

async function debugPDF() {
    const dataBuffer = fs.readFileSync('bank_statement_2.pdf');
    const data = new Uint8Array(dataBuffer);

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    console.log(`PDF loaded. Pages: ${pdf.numPages}`);

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        console.log(`\n--- Page ${i} ---`);

        const items = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5]
        }));

        // Group by Y
        const rows = {};
        items.forEach(item => {
            const y = Math.round(item.y);
            if (!rows[y]) rows[y] = [];
            rows[y].push(item);
        });

        const sortedYs = Object.keys(rows).map(Number).sort((a, b) => b - a);

        sortedYs.forEach(y => {
            const lineItems = rows[y].sort((a, b) => a.x - b.x);
            const lineStr = lineItems.map(i => `[${Math.round(i.x)}]${i.text}`).join('  ');
            console.log(`Y=${y}: ${lineStr}`);
        });
    }
}

debugPDF().catch(console.error);
