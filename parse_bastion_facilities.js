const fs = require('fs');

const data = fs.readFileSync('Resources/Dungeon Master\'s Guide (2024) - Ch. 8 Bastions.md', 'utf8');

// A quick and dirty regex to extract the Special Facilities table
const match = data.match(/\| Level \| Special Facility\s+\| Prerequisite\s+\| Order\s+\|(?:\n\|[ \-:]+\|)+\n([\s\S]+?)(?=\*Certain|\n\n)/m);

if (match) {
    const rows = match[1].trim().split('\n');
    const facilities = rows.map(r => {
        const cols = r.split('|').map(c => c.trim()).filter(c => c.length > 0);
        return {
            level: cols[0],
            name: cols[1],
            prerequisite: cols[2],
            order: cols[3]
        }
    });
    console.log(JSON.stringify(facilities, null, 2));
} else {
    console.log("No match found");
}

