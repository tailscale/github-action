# Makefile for building a TypeScript GitHub Action

# Variables
SHELL := /bin/bash
SRC_DIR := src
BUILD_DIR := dist
ENTRY_POINT := $(SRC_DIR)/index.ts

# Binaries
TS_NODE := ./node_modules/.bin/ts-node
TS_C := ./node_modules/.bin/tsc
ESLINT := ./node_modules/.bin/eslint
PRETTIER := ./node_modules/.bin/prettier

# Targets
.PHONY: all clean install build format

all: clean install build

# Clean up the lib directory
clean:
	rm -rf $(BUILD_DIR)

# Install npm dependencies
install:
	npm install

# Build the TypeScript code
build: clean format
	npm run build

# Lint the TypeScript code
lint:
	$(ESLINT) $(SRC_DIR)

# Format the TypeScript code
format:
	$(PRETTIER) --write "$(SRC_DIR)/**/*.ts"

# Run the action locally (for testing purposes)
run: build

