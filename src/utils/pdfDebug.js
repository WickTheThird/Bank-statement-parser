import * as pdfjsLib from 'pdfjs-dist';

// Set worker - use public folder for static serving
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/**
 * Extract raw coordinate data from PDF for debugging
 */
export async function extractRawPDFData(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group items by Y coordinate (rows)
      const rowsByY = {};

      textContent.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!rowsByY[y]) {
          rowsByY[y] = [];
        }
        rowsByY[y].push({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: y,
          width: item.width,
          height: item.height
        });
      });

      // Sort rows by Y position (top to bottom)
      const sortedYPositions = Object.keys(rowsByY).map(Number).sort((a, b) => b - a);

      const rows = sortedYPositions.map(y => {
        const items = rowsByY[y].sort((a, b) => a.x - b.x);
        return {
          y,
          items,
          text: items.map(item => item.text).join(' ')
        };
      });

      pages.push({
        pageNum,
        rows
      });
    }

    // Analyze column positions (numbers with .XX pattern)
    const numberXPositions = [];
    pages.forEach(page => {
      page.rows.forEach(row => {
        row.items.forEach(item => {
          if (/[\d,]+\.\d{2}/.test(item.text)) {
            numberXPositions.push(item.x);
          }
        });
      });
    });

    // Cluster X positions to find column boundaries
    numberXPositions.sort((a, b) => a - b);
    const columnXRanges = [];
    let currentCluster = [numberXPositions[0]];

    for (let i = 1; i < numberXPositions.length; i++) {
      if (numberXPositions[i] - numberXPositions[i-1] < 30) {
        currentCluster.push(numberXPositions[i]);
      } else {
        if (currentCluster.length > 0) {
          const avgX = Math.round(currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length);
          columnXRanges.push(avgX);
        }
        currentCluster = [numberXPositions[i]];
      }
    }
    if (currentCluster.length > 0) {
      const avgX = Math.round(currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length);
      columnXRanges.push(avgX);
    }

    return {
      pages,
      columnXRanges,
      totalPages: pdf.numPages
    };
  } catch (error) {
    console.error('PDF debug extraction error:', error);
    throw new Error(`Failed to extract PDF data: ${error.message}`);
  }
}
