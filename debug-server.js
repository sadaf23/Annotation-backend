// debug-gcs.js
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

// Configuration
const BUCKET_NAME = 'dermchatbot';
const IMAGE_FOLDER = 'scin_dataset/scin_images/concatenated_images';
const JSON_FOLDER = 'scin_dataset/scin_json/scin_json_initial_cases';
const NEW_JSON_FOLDER = 'scin_dataset/scin_new_json';

// Initialize Storage
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// Helper function to list files with prefix
async function listFiles(prefix) {
  try {
    console.log(`Listing files with prefix: ${prefix}`);
    const bucket = storage.bucket(BUCKET_NAME);
    const [files] = await bucket.getFiles({ prefix });
    
    console.log(`Found ${files.length} files.`);
    if (files.length > 0) {
      console.log('First 5 files:');
      files.slice(0, 5).forEach(file => console.log(`- ${file.name}`));
    }
    
    return files;
  } catch (error) {
    console.error(`Error listing files with prefix ${prefix}:`, error);
    throw error;
  }
}

// Main debugging function
async function debugGCSConnection() {
  console.log('Starting GCS connection debug...');
  
  try {
    // Check if the bucket exists
    console.log(`Checking if bucket "${BUCKET_NAME}" exists...`);
    const [bucketExists] = await storage.bucket(BUCKET_NAME).exists();
    if (!bucketExists) {
      console.error(`❌ Bucket "${BUCKET_NAME}" does not exist!`);
      return;
    }
    console.log(`✅ Bucket "${BUCKET_NAME}" exists.`);
    
    // List all root folders to understand structure
    console.log('\nListing root-level folders/files:');
    await listFiles('');
    
    // Check each specific folder
    console.log('\nChecking image folder:');
    await listFiles(IMAGE_FOLDER);
    
    console.log('\nChecking JSON folder:');
    await listFiles(JSON_FOLDER);
    
    console.log('\nChecking new JSON folder:');
    await listFiles(NEW_JSON_FOLDER);
    
    // Test accessing specific files if needed
    // For example, access first file in NEW_JSON_FOLDER if any exists
    const newJsonFiles = await listFiles(NEW_JSON_FOLDER);
    if (newJsonFiles.length > 0) {
      const testFile = newJsonFiles[0];
      console.log(`\nTesting access to file: ${testFile.name}`);
      const [exists] = await testFile.exists();
      console.log(`File exists: ${exists}`);
      
      if (exists) {
        console.log('Generating signed URL...');
        const [url] = await testFile.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000,
        });
        console.log(`Signed URL: ${url.substring(0, 100)}...`);
      }
    }
    
  } catch (error) {
    console.error('Debug failed with error:', error);
  }
}

// Run the debugging
debugGCSConnection().then(() => console.log('Debug complete.'));