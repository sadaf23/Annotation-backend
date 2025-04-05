# Use official Node.js image
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all files
COPY . .

# Expose port 8080 (used by Cloud Run)
EXPOSE 8080

# Start the server
CMD [ "npm", "start" ]
