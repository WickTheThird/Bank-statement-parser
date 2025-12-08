
const fs = require('fs');
const path = require('path');

const testPagePath = path.join(__dirname, 'src', 'TestPage.jsx');
const jsonPath = path.join(__dirname, 'boi_expected.json');

const testPageContent = fs.readFileSync(testPagePath, 'utf8');
const jsonContent = fs.readFileSync(jsonPath, 'utf8');

// Regex to find the EXPECTED_DATA_BOI array definition
// Matches "const EXPECTED_DATA_BOI = [" until "];" allowing for whitespace
const regex = /const EXPECTED_DATA_BOI = \[[\s\S]*?\]\s*;/;

if (!regex.test(testPageContent)) {
    console.error("Could not find EXPECTED_DATA_BOI in TestPage.jsx");
    process.exit(1);
}

const newContent = testPageContent.replace(regex, `const EXPECTED_DATA_BOI = ${jsonContent};`);

fs.writeFileSync(testPagePath, newContent);
console.log("Successfully updated TestPage.jsx with new expected data.");
