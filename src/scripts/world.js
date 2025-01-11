// ==========================================
// World container
//
// This class contains the elements that make up the game world.
// Other modules retrieve information from the world or alter it
// using this class.
// ==========================================

import { Vector } from './helpers.js'; // Ensure Vector is imported
import { BLOCK } from './blocks.js'; // Ensure BLOCK is imported
import { createNoise3D } from 'simplex-noise';
import alea from 'alea';
import PerlinNoise from './perlin.js'; // Update this import

class World {
	// Constructor( sx, sy, sz )
	//
	// Creates a new world container with the specified world size.
	// Up and down should always be aligned with the Z-direction.
	//
	// sx - World size in the X-direction.
	// sy - World size in the Y-direction.
	// sz - World size in the Z-direction.

	constructor(sx, sy, sz) {
		// Initialize Perlin noise first
        this.perlin = new PerlinNoise();
		
		if (sx <= 0 || sy <= 0 || sz <= 0) {
			throw new Error("World dimensions must be positive non-zero values.");
		}
		this.sx = sx;
		this.sy = sy;
		this.sz = sz;
		this.blocks = this.generateTerrain(sx, sy, sz); // Use generateTerrain instead of createFlatWorld
		this.spawnPoint = this.findSpawnPoint(); // Adjust spawn point after terrain generation
		this.players = {};
		console.log("World created with dimensions:", sx, sy, sz); // Add logging
		console.log("Spawn point:", this.spawnPoint); // Add logging
		console.log("Block at spawn point:", this.getBlock(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z)); // Add logging

		// Add chunk management
		this.chunkCache = new Map();
		this.maxCachedChunks = 512; // Adjust based on available memory

		// Initialize lightmap
		this.lightmap = new Array(sx).fill(null)
			.map(() => new Array(sy).fill(0)
				.map(() => 0));
				
		// Calculate initial lighting
		this.updateLighting();
	}

	// Add method to find the highest spawnable and non-transparent block in the spawn column
	findSpawnPoint() {
		const x = Math.floor(this.sx / 2);
		const y = Math.floor(this.sy / 2);
		
		 // Create a guaranteed solid platform at spawn
		 const spawnZ = Math.floor(this.sz * 0.6);
		 
		 // Create a safe spawn platform
		 for (let dx = -2; dx <= 2; dx++) {
			 for (let dy = -2; dy <= 2; dy++) {
				 this.blocks[x + dx][y + dy][spawnZ - 1] = this.validateBlock(BLOCK.DIRT);
				 this.blocks[x + dx][y + dy][spawnZ] = this.validateBlock(BLOCK.AIR);
				 this.blocks[x + dx][y + dy][spawnZ + 1] = this.validateBlock(BLOCK.AIR);
			 }
		 }
		 
		 console.log("Created spawn platform at", x, y, spawnZ);
		 return new Vector(x, y, spawnZ);
	}

	// Add bounds checking helper
	isInBounds(x, y, z) {
		return x >= 0 && x < this.sx && 
			   y >= 0 && y < this.sy && 
			   z >= 0 && z < this.sz;
	}

	// Helper method to validate block
	validateBlock(block) {
		if (!block || typeof block.id !== 'number') {
			return BLOCK.AIR; // Return air block instead of null
		}
		if (block.id === BLOCK.AIR.id) {
			return BLOCK.AIR; // Ensure air blocks are returned as air blocks
		}
		// Handle rentgen view blocks
        if (block.rentgenView) {
            return {
                ...block,
                transparent: true,
                opacity: 0.3
            };
        }
		// Handle X-ray view blocks
        if (block.xray) {
            return {
                ...block,
                transparent: true,
                opacity: 0.3
            };
        }
		return BLOCK.validateBlockType(block);
	}

	// Generate terrain using 3D simplex noise with multiple density functions
	generateTerrain(sx, sy, sz) {
		try {
			console.log("Generating terrain...");
			const seed = 'minecraft';
			const noise3D = createNoise3D(alea(seed));
			const blocks = Array.from({ length: sx }, () =>
				Array.from({ length: sy }, () =>
					Array(sz).fill(BLOCK.AIR)
				)
			);

			// Add bedrock layer at bottom
			for (let x = 0; x < sx; x++) {
				for (let y = 0; y < sy; y++) {
					blocks[x][y][0] = this.validateBlock(BLOCK.BEDROCK);
				}
			}

			 // Adjust terrain parameters for more pronounced features
			 const biomeScale = 24;        // Smaller value = more varied terrain
			 const heightScale = sz / 2;   // Increased height variation
			 const amplitude = 1.0;        // Increased amplitude
			 const octaves = 4;
			 const persistence = 0.5;      // How much each octave contributes
			 const baseHeight = Math.floor(sz * 0.5); // Base terrain height at 50%
			 const waterLevel = Math.floor(sz * 0.5); // Define water level
			 const treeChance = 0.0045; // Define tree spawn chance
 
			 for (let x = 0; x < sx; x++) {
				 for (let y = 0; y < sy; y++) {
					 // Generate terrain height
					 let heightValue = 0;
					 let amp = amplitude;
					 let freq = 1.0;
					 let totalAmp = 0;
 
					 // Generate multi-octave noise
					 for (let o = 0; o < octaves; o++) {
						 heightValue += amp * noise3D(x * freq / biomeScale, y * freq / biomeScale, 0);
						 totalAmp += amp;
						 amp *= persistence;
						 freq *= 2;
					 }
 
					 // Normalize and scale height value
					 heightValue = (heightValue / totalAmp + 1) * 0.5; // Normalize to 0-1
					 const finalHeight = Math.floor(baseHeight + heightValue * heightScale * 0.3);
					 
					 // Generate terrain column
					 for (let z = 0; z < sz; z++) {
						 if (z === 0) {
							 blocks[x][y][z] = this.validateBlock(BLOCK.BEDROCK);
						 } else if (z < finalHeight - 4) {
							 blocks[x][y][z] = this.validateBlock(BLOCK.ROCK); // Add rock layer
						 } else if (z < finalHeight - 1) {
							 blocks[x][y][z] = this.validateBlock(BLOCK.DIRT);
						 } else if (z < finalHeight) {
							 blocks[x][y][z] = this.validateBlock(BLOCK.DIRT);
						 } else if (z <= waterLevel) { // Changed to <= to ensure water fills up
							 blocks[x][y][z] = this.validateBlock(BLOCK.WATER);
						 } else {
							 blocks[x][y][z] = this.validateBlock(BLOCK.AIR);
						 }
					 }

					 // Add trees on exposed dirt blocks above water
					 if (finalHeight > waterLevel && Math.random() < treeChance) {
						 this.addTree(blocks, x, y, finalHeight);
					 }
				 }
			 }

			 // Generate caves using Perlin noise
			 this.generateCaves(blocks, sx, sy, sz);

			 // Create a safe spawn platform at the center
			 const centerX = Math.floor(sx / 2);
			 const centerY = Math.floor(sy / 2);
			 const spawnHeight = Math.floor(sz * 0.6);
			 
			 // Create a small platform of solid blocks at spawn
			 for (let x = centerX - 2; x <= centerX + 2; x++) {
				 for (let y = centerY - 2; y <= centerY + 2; y++) {
					 blocks[x][y][spawnHeight - 1] = this.validateBlock(BLOCK.DIRT);
					 blocks[x][y][spawnHeight] = this.validateBlock(BLOCK.AIR);
					 blocks[x][y][spawnHeight + 1] = this.validateBlock(BLOCK.AIR);
				 }
			 }

			 // Ensure all blocks are properly validated
			 for (let x = 0; x < sx; x++) {
				 for (let y = 0; y < sy; y++) {
					 for (let z = 0; z < sz; z++) {
						 blocks[x][y][z] = this.validateBlock(blocks[x][y][z]);
					 }
				 }
			 }

			console.log("Generated terrain with heights:", {
				baseHeight,
				maxHeight: sz,
				centerHeight: blocks[centerX][centerY].findIndex(block => block.id === BLOCK.AIR)
			});

			return blocks;
		} catch (error) {
			console.error("Failed to generate terrain:", error);
			// Fallback to flat world
			return this.createFlatWorld(Math.floor(sz / 2));
		}
	}

	// Add method to generate caves using Perlin noise
	generateCaves(blocks, sx, sy, sz) {
        if (!this.perlin) {
            console.warn('Perlin noise not initialized, skipping cave generation');
            return;
        }

        // Optimize cave generation parameters
        const caveParams = {
            scale: 0.05,        // Base scale for primary cave noise
            detail: 0.1,        // Scale for detail noise
            threshold: 0.3,     // Base threshold for cave formation
            amplitude: 0.7,     // Noise amplitude
            persistence: 0.5,   // How noise changes with height
            minHeight: 5,      // Minimum height for caves
            maxHeight: sz - 10  // Maximum height for caves
        };

        // Pre-calculate height factors
        const heightRange = caveParams.maxHeight - caveParams.minHeight;
        const heightFactor = 1 / heightRange;

        // Use a single loop for better performance
        for (let x = 0; x < sx; x++) {
            for (let y = 0; y < sy; y++) {
                for (let z = caveParams.minHeight; z < caveParams.maxHeight; z++) {
                    // Skip if block is already air or water
                    if (blocks[x][y][z]?.id === BLOCK.AIR.id || 
                        blocks[x][y][z]?.id === BLOCK.WATER.id) {
                        continue;
                    }

                    // Calculate height-based threshold
                    const heightInfluence = (z - caveParams.minHeight) * heightFactor;
                    const localThreshold = caveParams.threshold + 
                        (heightInfluence * caveParams.persistence);

                    // Generate primary cave noise
                    const primaryNoise = this.perlin.noise3D(
                        x * caveParams.scale,
                        y * caveParams.scale,
                        z * caveParams.scale
                    );

                    // Generate detail noise
                    const detailNoise = this.perlin.noise3D(
                        x * caveParams.detail + 100,
                        y * caveParams.detail + 100,
                        z * caveParams.detail + 100
                    ) * 0.5;

                    // Combine noises
                    const combinedNoise = (primaryNoise + detailNoise) * caveParams.amplitude;

                    // Create cave if noise exceeds threshold
                    if (combinedNoise > localThreshold) {
                        blocks[x][y][z] = this.validateBlock(BLOCK.AIR);

                        // Optional: Create small cavities around main cave
                        if (combinedNoise > localThreshold + 0.1) {
                            this.createCavity(blocks, x, y, z, sx, sy, sz);
                        }
                    }
                }
            }
        }
    }

    createCavity(blocks, x, y, z, sx, sy, sz) {
        // Create small random cavities around the main cave
        const radius = 1;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    const nz = z + dz;

                    if (this.isInBounds(nx, ny, nz) && 
                        blocks[nx][ny][nz]?.id !== BLOCK.AIR.id &&
                        blocks[nx][ny][nz]?.id !== BLOCK.WATER.id &&
                        Math.random() < 0.3) {
                        blocks[nx][ny][nz] = this.validateBlock(BLOCK.AIR);
                    }
                }
            }
        }
    }

	addTree(blocks, x, y, z) {
		// Early bounds check with padding for full tree
		if (!this.isInBounds(x + 2, y + 2, z + 6)) return;
		if (!this.isInBounds(x - 2, y - 2, z)) return;
	
		// Tree height between 5-7 blocks
		const height = 5 + Math.floor(Math.random() * 3);
	
		// Create trunk
		for (let i = 0; i < height; i++) {
			blocks[x][y][z + i] = this.validateBlock(BLOCK.WOOD);
		}
	
		// Create leaves in a more natural pattern
		const leafStart = z + height - 3;
		for (let lz = 0; lz <= 3; lz++) {
			const radius = (lz === 0 || lz === 3) ? 1 : 2;
			for (let lx = -radius; lx <= radius; lx++) {
				for (let ly = -radius; ly <= radius; ly++) {
					// Create a more natural circular pattern
					if (Math.sqrt(lx * lx + ly * ly) <= radius + 0.5) {
						const nx = x + lx;
						const ny = y + ly;
						const nz = leafStart + lz;
						
						if (this.isInBounds(nx, ny, nz) && 
							blocks[nx][ny][nz]?.id === BLOCK.AIR.id) {
							blocks[nx][ny][nz] = this.validateBlock(BLOCK.LEAVES);
						}
					}
				}
			}
		}
	}

	addCave(blocks, startX, startY, startZ) {
		// Early bounds check
		if (!this.isInBounds(startX, startY, startZ)) return;
		
		const length = 10 + Math.floor(Math.random() * 20);
		let x = startX;
		let y = startY;
		let z = startZ;
		
		let dx = Math.random() * 2 - 1;
		let dy = Math.random() * 2 - 1;
		let dz = Math.random() * 2 - 1;

		const maxIterations = 1000;
		let iterations = 0;

		while (iterations < maxIterations && iterations < length) {
			// Floor coordinates for array access
			const ix = Math.floor(x);
			const iy = Math.floor(y);
			const iz = Math.floor(z);

			// Check bounds before modifying blocks
			if (this.isInBounds(ix, iy, iz)) {
				blocks[ix][iy][iz] = null; // Use null instead of AIR
				
				// Create small cavity around the main tunnel
				for (let ox = -1; ox <= 1; ox++) {
					for (let oy = -1; oy <= 1; oy++) {
						for (let oz = -1; oz <= 1; oz++) {
							const nx = ix + ox;
							const ny = iy + oy;
							const nz = iz + oz;
							if (this.isInBounds(nx, ny, nz) && Math.random() < 0.3) {
								blocks[nx][ny][nz] = null; // Use null instead of AIR
							}
						}
					}
				}

				// Update position
				x += dx;
				y += dy;
				z += dz;

				// Gradually change direction
				dx += (Math.random() - 0.5) * 0.1;
				dy += (Math.random() - 0.5) * 0.1;
				dz += (Math.random() - 0.5) * 0.1;

				// Clamp direction changes
				dx = Math.max(-1, Math.min(1, dx));
				dy = Math.max(-1, Math.min(1, dy));
				dz = Math.max(-1, Math.min(1, dz));

				iterations++;
			} else {
				// Stop if we hit the bounds
				break;
			}
		}
	}

	// createFlatWorld()
	//
	// Sets up the world so that the bottom half is filled with dirt
	// and the top half with air.

	createFlatWorld(height) {
		if (height < 0 || height > this.sz) {
			throw new Error("Invalid height for flat world.");
		}
		this.spawnPoint = new Vector(this.sx / 2 + 0.5, this.sy / 2 + 0.5, height);

		const blocks = Array.from({ length: this.sx }, () =>
			Array.from({ length: this.sy }, () =>
				Array(this.sz).fill(BLOCK.AIR)
			)
		);

		for (let x = 0; x < this.sx; x++) {
			for (let y = 0; y < this.sy; y++) { // Fix loop condition
				for (let z = 0; z < this.sz; z++) {
					blocks[x][y][z] = z < height ? BLOCK.DIRT : BLOCK.AIR;
				}
			}
		}
		
		return blocks;
	}

	// createFromString( str )
	//
	// Creates a world from a string representation.
	// This is the opposite of toNetworkString().
	//
	// NOTE: The world must have already been created
	// with the appropriate size!

	createFromString(str) {
		if (str.length !== this.sx * this.sy * this.sz) {
			throw new Error("String length does not match world dimensions.");
		}
		console.log("Creating world from string:", str); // Add logging
		let i = 0;

		for (let x = 0; x < this.sx; x++) {
			for (let y = 0; y < this.sy; y++) {
				for (let z = 0; z < this.sz; z++) {
					this.blocks[x][y][z] = BLOCK.fromId(str.charCodeAt(i) - 97);
					i++;
				}
			}
		}
		console.log("World created from string successfully"); // Add logging
	}

	// getBlock( x, y, z )
	//
	// Get the type of the block at the specified position.
	// Mostly for neatness, since accessing the array
	// directly is easier and faster.

	getBlock(x, y, z) {
		if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) 
			return null; // Return null instead of AIR
		return this.validateBlock(this.blocks[x][y][z]);
	}

	// setBlock( x, y, z )

	setBlock(x, y, z, type, metadata = {}) {
		if (!this.isInBounds(x, y, z)) return false;
		
		// Handle X-ray blocks efficiently
        const block = type.xray ? 
            { ...type, transparent: true, opacity: 0.3 } : 
            this.validateBlock(type);
            
        this.blocks[x][y][z] = { ...block, metadata };

        // Batch renderer updates
        if (this.renderer && !type.xray) {
            this.renderer.onBlockChanged(x, y, z);
        }
        return true;
	}

	// toNetworkString()
	//
	// Returns a string representation of this world.

	toNetworkString() {
		const blockArray = [];

		for (let x = 0; x < this.sx; x++) {
			for (let y = 0; y < this.sy; y++) { // Fixed condition: was using x < this.sy
				for (let z = 0; z < this.sz; z++) {
					const block = this.validateBlock(this.blocks[x][y][z]);
					blockArray.push(String.fromCharCode(97 + block.id));
				}
			}
		}

		return blockArray.join("");
	}

	// Removed saveToFile method

    // Add static method for world generation
    static async generateWorld(sx, sy, sz) {
        return new Promise((resolve, reject) => {
            try {
                if (!Number.isInteger(sx) || !Number.isInteger(sy) || !Number.isInteger(sz)) {
                    throw new Error("World dimensions must be integers");
                }
                if (sx <= 0 || sy <= 0 || sz <= 0) {
                    throw new Error("World dimensions must be positive");
                }
                if (sx > 254 || sy > 254 || sz > 254) {
                    throw new Error("World dimensions cannot exceed 254");
                }
                
                const world = new World(sx, sy, sz);
                resolve(world);
            } catch (error) {
                reject(new Error(`Failed to generate world: ${error.message}`));
            }
        });
    }

	manageChunks() {
		// Remove chunks that are too far from player
		if (this.chunkCache.size > this.maxCachedChunks) {
			const playerChunk = this.getChunkAt(this.localPlayer.pos);
			const chunksArray = Array.from(this.chunkCache.entries());
			chunksArray.sort((a, b) => {
				const distA = this.getChunkDistance(a[0], playerChunk);
				const distB = this.getChunkDistance(b[0], playerChunk);
				return distB - distA;
			});

			// Remove furthest chunks
			const toRemove = chunksArray.slice(this.maxCachedChunks);
			for (const [key] of toRemove) {
				this.chunkCache.delete(key);
			}
		}
	}

	// Add lighting calculation
	updateLighting() {
		for (let x = 0; x < this.sx; x++) {
			for (let y = 0; y < this.sy; y++) {
				let maxZ = this.sz - 1;
				for (let z = this.sz - 1; z >= 0; z--) {
					if (!this.blocks[x][y][z].transparent) {
						maxZ = z;
						break;
					}
				}
				this.lightmap[x][y] = maxZ;
			}
		}
	}

	// Optimize lighting updates
	updateLightingAt(x, y, z) {
		if (!this.isInBounds(x, y, z)) return;
		
		const block = this.blocks[x][y][z];
		if (!block || block.transparent) return;

		const lightLevel = block.selflit ? 15 : 0;
		this.lightmap[x][y] = Math.max(this.lightmap[x][y], lightLevel);

		// Propagate light to neighboring blocks
		const neighbors = [
			[x + 1, y, z], [x - 1, y, z],
			[x, y + 1, z], [x, y - 1, z],
			[x, y, z + 1], [x, y, z - 1]
		];

		for (const [nx, ny, nz] of neighbors) {
			if (this.isInBounds(nx, ny, nz)) {
				const neighborBlock = this.blocks[nx][ny][nz];
				if (neighborBlock && neighborBlock.transparent) {
					this.lightmap[nx][ny] = Math.max(this.lightmap[nx][ny], lightLevel - 1);
				}
			}
		}
	}

	// Lazy updates for lighting and rendering
	lazyUpdate() {
		if (this.updateQueue.length === 0) return;

		const [x, y, z] = this.updateQueue.shift();
		this.updateLightingAt(x, y, z);

		if (this.renderer) {
			this.renderer.onBlockChanged(x, y, z);
		}
	}

	// Chunk-based loading and updates
	loadChunk(cx, cy, cz) {
		const chunk = this.generateChunk(cx, cy, cz);
		this.chunkCache.set(`${cx},${cy},${cz}`, chunk);
		return chunk;
	}

	generateChunk(cx, cy, cz) {
		const chunk = [];
		for (let x = 0; x < this.chunkSize; x++) {
			chunk[x] = [];
			for (let y = 0; y < this.chunkSize; y++) {
				chunk[x][y] = [];
				for (let z = 0; z < this.chunkSize; z++) {
					chunk[x][y][z] = this.generateBlock(cx * this.chunkSize + x, cy * this.chunkSize + y, cz * this.chunkSize + z);
				}
			}
		}
		return chunk;
	}

	generateBlock(x, y, z) {
		// Implement block generation logic here
		return this.validateBlock(BLOCK.DIRT);
	}

	setWorld(world, chunkSize) {
		console.log("Setting world with dimensions:", world.sx, world.sy, world.sz);
		this.world = world;
		world.renderer = this;
		this.chunkSize = chunkSize;
	
		// Create chunk list
		const chunks = this.chunks = [];
		for (let x = 0; x < world.sx; x += chunkSize) {
			for (let y = 0; y < world.sy; y += chunkSize) {
				for (let z = 0; z < world.sz; z += chunkSize) {
					chunks.push({
						start: [x, y, z],
						end: [Math.min(world.sx, x + chunkSize), Math.min(world.sy, y + chunkSize), Math.min(world.sz, z + chunkSize)],
						dirty: true
					});
				}
			}
		}
		console.log("Chunks created:", chunks.length);
	}

	getChunkAtBlock(x, y, z) {
        if (!this.chunkSize) return null;
        
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        const cz = Math.floor(z / this.chunkSize);
        
        return [cx, cy, cz];
    }
}

// Export to ES6 modules
export { World };