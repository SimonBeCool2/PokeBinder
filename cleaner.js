const fs = require('fs');
const path = require('path');

// Path to your JSON file
const jsonFilePath = path.join(__dirname, 'items_simon.json');

// Function to load items from the JSON file
const loadItems = () => {
    try {
        const data = fs.readFileSync(jsonFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading file:', err);
        return [];
    }
};

// Function to save items to the JSON file
const saveItems = (items) => {
    try {
        fs.writeFileSync(jsonFilePath, JSON.stringify(items, null, 2));
        console.log('Items successfully saved.');
    } catch (err) {
        console.error('Error writing file:', err);
    }
};

// Function to assign unique IDs to each item
const assignIds = (items) => {
    return items.map((item, index) => {
        item.index = index;
        return item;
    });
};

// Main function to clean and update items
const cleanItems = () => {
    const items = loadItems();
    const updatedItems = assignIds(items);
    saveItems(updatedItems);
    console.log('Items have been updated with unique IDs.');
};

module.exports = { cleanItems };