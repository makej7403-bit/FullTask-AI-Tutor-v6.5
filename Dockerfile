# Install Node
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy all project files
COPY . .

# Expose port
EXPOSE 3000

# Build Next.js
RUN npm run build

# Run app
CMD ["npm", "start"]
