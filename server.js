

const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// 🔹 Google Cloud Storage setup
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Ensure this is correctly set
});

const BUCKET_NAME = 'dermchatbot';
const IMAGE_FOLDER = 'scin_dataset/scin_images/concatenated_images';
const JSON_FOLDER = 'scin_dataset/scin_json/scin_json_initial_cases';
const JSON_NEW_FOLDER = 'scin_dataset/scin_json/scin_new_json';

const ANNOTATOR_HISTORY_FOLDER = 'annotator_history';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

app.get('/data/random/:annotatorId', async (req, res) => {
    try {
        const { annotatorId } = req.params;
        if (!annotatorId) {
            return res.status(400).json({ error: 'Annotator ID is required' });
        }

        console.log(`Getting random file for annotator: ${annotatorId}`);
        const bucket = storage.bucket(BUCKET_NAME);

        // Get all JSON files
        const [jsonFiles] = await bucket.getFiles({ prefix: JSON_FOLDER });
        const jsonFilenames = jsonFiles.map(file => file.name);
        
        // Get all image files
        const [imageFiles] = await bucket.getFiles({ prefix: IMAGE_FOLDER });
        const imageFilenames = imageFiles.map(file => file.name);

        // Get annotator's history from GCS
        const annotatorHistoryFile = bucket.file(`${ANNOTATOR_HISTORY_FOLDER}/${annotatorId}.json`);
        let annotatedFiles = [];

        try {
            const [content] = await annotatorHistoryFile.download();
            annotatedFiles = JSON.parse(content.toString()).annotatedFiles || [];
        } catch (error) {
            // If file doesn't exist, initialize with empty array
            if (error.code !== 404) throw error;
        }

        // Filter out already annotated files
        const availableJsonFiles = jsonFilenames.filter(filename => {
            const baseFilename = path.basename(filename);
            return !annotatedFiles.includes(baseFilename);
        });

        if (availableJsonFiles.length === 0) {
            return res.status(404).json({ 
                error: 'No more files available for annotation',
                message: 'All files have been annotated by this annotator'
            });
        }

        // Select a random file
        const randomIndex = Math.floor(Math.random() * availableJsonFiles.length);
        const selectedJsonFile = availableJsonFiles[randomIndex];
        const jsonBasename = path.basename(selectedJsonFile);
        
        // Find matching image file
        const matchingImageFile = imageFilenames.find(imgFile => 
            path.basename(imgFile, path.extname(imgFile)) === 
            path.basename(jsonBasename, path.extname(jsonBasename))
        );

        if (!matchingImageFile) {
            return res.status(404).json({ 
                error: 'Matching image not found',
                jsonFile: selectedJsonFile
            });
        }

        res.json({
            jsonFiles: [selectedJsonFile],
            imageFiles: [matchingImageFile]
        });

    } catch (error) {
        console.error('Error retrieving random file:', error.stack || error);
        res.status(500).json({ error: 'Failed to retrieve random file' });
    }
});


// 🔹 Get list of JSON & image files (original function kept for backward compatibility)
app.get('/data', async (req, res) => {
    try {
        const bucket = storage.bucket(BUCKET_NAME);

        console.log(`Looking for images in bucket: ${BUCKET_NAME} with prefix: ${IMAGE_FOLDER}`);
        const [imageFiles] = await bucket.getFiles({ prefix: IMAGE_FOLDER });
        console.log(`Found ${imageFiles.length} image files`);

        console.log(`Looking for JSON in bucket: ${BUCKET_NAME} with prefix: ${JSON_FOLDER}`);
        const [jsonFiles] = await bucket.getFiles({ prefix: JSON_FOLDER });
        console.log(`Found ${jsonFiles.length} JSON files`);

        res.json({
            jsonFiles: jsonFiles.map(file => file.name),
            imageFiles: imageFiles.map(file => file.name)
        });

    } catch (error) {
        console.error('Error retrieving files:', error.stack || error);
        res.status(500).json({ error: 'Failed to retrieve files' });
    }
});

// 🔹 Serve JSON content
app.get('/json/:filename', async (req, res) => {
    const { filename } = req.params;
    try {
        console.log(`Retrieving JSON file: ${filename}`);
        const bucket = storage.bucket(BUCKET_NAME);
        const [files] = await bucket.getFiles({ prefix: JSON_FOLDER });
        const [newFiles] = await bucket.getFiles({ prefix: JSON_NEW_FOLDER });

        const allFiles = [...files, ...newFiles];
        const targetFile = allFiles.find(file => file.name.includes(filename));

        if (!targetFile) {
            console.log(`JSON file not found: ${filename}`);
            return res.status(404).json({ error: 'JSON file not found' });
        }

        console.log(`Found matching JSON: ${targetFile.name}`);
        const [content] = await targetFile.download();
        res.json(JSON.parse(content.toString()));

    } catch (error) {
        console.error('Error retrieving JSON:', error.stack || error);
        res.status(500).json({ error: 'Failed to retrieve JSON' });
    }
});

// 🔹 Serve image URL
app.get('/image/:filename', async (req, res) => {
    const { filename } = req.params;
    try {
        console.log(`Fetching image: ${filename}`);
        const bucket = storage.bucket(BUCKET_NAME);
        const [files] = await bucket.getFiles({ prefix: IMAGE_FOLDER });

        const targetFile = files.find(file => file.name.includes(filename));
        if (!targetFile) {
            console.log(`Image not found: ${filename}`);
            return res.status(404).json({ error: 'Image file not found' });
        }

        const [url] = await targetFile.getSignedUrl({
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000,
        });

        res.json({ imageUrl: url });
    } catch (error) {
        console.error('Error fetching image:', error.stack || error);
        res.status(500).json({ error: 'Failed to retrieve image' });
    }
});

// 🔹 Upload JSON File to GCS with versioning
app.put('/upload/:filename', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const annotatorId = req.query.annotatorId;
        
        console.log(`Uploading JSON file: ${filename} by annotator: ${annotatorId}`);

        if (!filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid file type' });
        }

        if (!annotatorId) {
            return res.status(400).json({ error: 'Annotator ID is required' });
        }

        // Verify that req.body contains data
        if (!req.body || Object.keys(req.body).length === 0) {
            console.error('Empty request body');
            return res.status(400).json({ error: 'Empty request body' });
        }

        const bucket = storage.bucket(BUCKET_NAME);
        const baseFilename = filename.replace('_annotated.json', '');
        
        // Create the destination path for the new JSON file
        const destinationPath = `${JSON_NEW_FOLDER}/${baseFilename}_annotated.json`;
        
        const file = bucket.file(destinationPath);
        const jsonData = JSON.stringify(req.body, null, 2);

        console.log(`Saving file to: ${destinationPath}`);
        console.log(`Data size: ${jsonData.length} characters`);

        // Upload to GCS with promise
        await file.save(jsonData, {
            metadata: { contentType: 'application/json' }
        });
        
        // Verify the file exists after upload
        const [exists] = await file.exists();
        if (!exists) {
            console.error('File was not found after upload');
            return res.status(500).json({ error: 'File upload failed - file not found after upload' });
        }
        
        // Update annotator history in GCS
        const annotatorHistoryFile = bucket.file(`${ANNOTATOR_HISTORY_FOLDER}/${annotatorId}.json`);
        let historyData = { annotatedFiles: [] };

        try {
            const [content] = await annotatorHistoryFile.download();
            historyData = JSON.parse(content.toString());
        } catch (error) {
            if (error.code !== 404) throw error; // Handle other errors
        }

        // Add the new annotated file to the history
        historyData.annotatedFiles.push(path.basename(destinationPath));
        await annotatorHistoryFile.save(JSON.stringify(historyData), {
            metadata: { contentType: 'application/json' }
        });

        console.log(`JSON file uploaded successfully: ${filename}`);
        res.status(200).json({ 
            message: 'JSON uploaded successfully!',
            path: destinationPath
        });
    } catch (error) {
        console.error('Server Error in upload:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message
        });
    }
});



app.get('/annotator/progress/:annotatorId', async (req, res) => {
    try {
        const { annotatorId } = req.params;
        const bucket = storage.bucket(BUCKET_NAME);
        // Get annotator history from GCS
        const annotatorHistoryFile = bucket.file(`${ANNOTATOR_HISTORY_FOLDER}/${annotatorId}.json`);
        let annotatedFiles = [];

        try {
            const [content] = await annotatorHistoryFile.download();
            annotatedFiles = JSON.parse(content.toString()).annotatedFiles || [];
        } catch (error) {
            if (error.code !== 404) throw error; // Handle other errors
        }
        
        
        const [jsonFiles] = await bucket.getFiles({ prefix: JSON_FOLDER });
        
        res.json({
            annotated: annotatedFiles.length,
            total: jsonFiles.length,
            remaining: jsonFiles.length - annotatedFiles.length,
            completionPercentage: (annotatedFiles.length / jsonFiles.length) * 100
        });
    } catch (error) {
        console.error('Error getting annotator progress:', error);
        res.status(500).json({ error: 'Failed to retrieve annotator progress' });
    }
});

app.post('/upload-tracking', async (req, res) => {
    try {
        const { csv, filename } = req.body;

        // ✅ Create a file object in memory (without saving locally)
        const file = storage.bucket(BUCKET_NAME).file(`user-tracking/${filename}`);

        // ✅ Upload CSV directly from memory
        await file.save(csv, {
            contentType: 'text/csv',
        });

        res.status(200).json({ message: 'Tracking data uploaded successfully!' });
    } catch (error) {
        console.error('Error uploading tracking data:', error);
        res.status(500).json({ error: 'Failed to upload tracking data' });
    }
});

app.get("/", (req, res) => {
    res.send("Server is running!");
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});