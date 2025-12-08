# Bank Statement Parser

A web-based tool for parsing bank statements from PDF files and converting them to Excel format.

## Features

- PDF bank statement parsing
- CSV data processing
- Excel export functionality
- Drag-and-drop file upload
- Modern React-based UI with Tailwind CSS

## Technologies

- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **PDF.js** - PDF parsing
- **Papa Parse** - CSV parsing
- **XLSX** - Excel file generation
- **Tailwind CSS** - Styling
- **React Dropzone** - File upload handling

## Getting Started

### Prerequisites

- Node.js (v16 or higher recommended)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

This will start the development server. Open your browser and navigate to the URL shown in the terminal (typically `http://localhost:5173`).

### Build

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Usage

1. Open the application in your browser
2. Drag and drop your bank statement PDF file or click to browse
3. The application will parse the PDF and extract transaction data
4. Download the processed data as an Excel file

## License

This project is proprietary and confidential. See [LICENSE](LICENSE) for details.

Copyright (c) 2025 WickTheThird. All Rights Reserved.

## Security

This application processes sensitive financial data. Never upload bank statements to untrusted servers. This tool is designed to run locally in your browser for maximum security.
