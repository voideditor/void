const fs = require('fs');
const { execSync } = require('child_process');
const semver = require('semver');

function updateProductJson(type = 'patch') {
	// Read product.json
	const productJsonPath = './product.json';
	const product = require('../' + productJsonPath);

	// Update the version
	product.voidVersion = semver.inc(product.voidVersion, type);

	// Update the commit hash
	product.commit = execSync('git rev-parse HEAD').toString().trim();

	// Update the date
	product.date = new Date().toISOString().split('T')[0];

	// Write the modifications
	fs.writeFileSync(productJsonPath, JSON.stringify(product, null, 2));

	return product.voidVersion;
}

// Execute the update
const newVersion = updateProductJson(process.argv[2] || 'patch');
console.log(`Updated version: ${newVersion}`);
