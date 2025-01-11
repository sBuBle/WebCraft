// ==========================================
// Block types
//
// This file contains all available block types and their properties.
// ==========================================

const DIRECTION = {
    UP: 1,
    DOWN: 2,
    LEFT: 3,
    RIGHT: 4,
    FORWARD: 5,
    BACK: 6
};

// Fix pushQuad helper function
function pushQuad(vertices, v1, v2, v3, v4) {
    // Validate vertices array 
    if (!vertices || !Array.isArray(vertices)) {
        console.error('Invalid vertices array');
        return false;
    }

    // Validate vertex arrays
    const validateVertex = v => Array.isArray(v) && v.length === 9 && 
        v.every(n => typeof n === 'number' && !isNaN(n));

    if (!validateVertex(v1) || !validateVertex(v2) || 
        !validateVertex(v3) || !validateVertex(v4)) {
        console.error('Invalid vertex data');
        return false;
    }

    try {
        // Push vertices for first triangle
        vertices.push(...v1, ...v2, ...v3);
        // Push vertices for second triangle
        vertices.push(...v3, ...v4, ...v1);
        return true;
    } catch (err) {
        console.error('Failed to push vertices:', err);
        return false;
    }
}

const BLOCK = {
    // Block validation helper
    validateBlockType(block) {
        const defaultBlock = {
            id: 0,
            spawnable: false,
            transparent: true,
            selflit: false,
            gravity: false,
            fluid: false,
            texture: function(world, lightmap, lit, x, y, z, dir) { 
                return [0, 0, 1, 1]; 
            }
        };

        if (!block) return defaultBlock; // Return default block instead of null
        
        // Create a new object with all properties
        const validatedBlock = { ...defaultBlock, ...block };
        
        // Ensure texture function exists and bind it to the block
        if (typeof validatedBlock.texture !== 'function') {
            validatedBlock.texture = defaultBlock.texture.bind(validatedBlock);
        } else {
            const originalTexture = validatedBlock.texture;
            validatedBlock.texture = originalTexture.bind(validatedBlock);
        }

        // Validate texture coordinates
        const validateTextureCoords = (coords) => {
            if (!Array.isArray(coords) || coords.length !== 4) {
                return [0, 0, 1, 1]; // Default texture coordinates
            }
            return coords.map(coord => Math.max(0, Math.min(1, coord)));
        };

        // Wrap texture function
        const boundTexture = validatedBlock.texture;
        validatedBlock.texture = function(...args) {
            const coords = boundTexture(...args);
            return validateTextureCoords(coords);
        };

        return validatedBlock;
    },

    // Block type lookup by ID
    fromId(id) {
        if (id === undefined || id < 0) {
            console.warn(`Invalid block id: ${id}, returning default block`);
            return this.validateBlockType(null); // Return default block
        }

        for (const type in this) {
            if (this[type] && typeof this[type] === 'object' && this[type].id === id) {
                return this.validateBlockType(this[type]);
            }
        }
        console.warn(`Unknown block id: ${id}, returning default block`);
        return this.validateBlockType(null); // Return default block
    },

    // Add vertex pushing methods
    pushVertices(vertices, world, lightmap, x, y, z) {
        const blocks = world.blocks;
        if (!blocks?.[x]?.[y]?.[z]) return;
        
        const block = blocks[x][y][z];
        if (!block || block.id === BLOCK.AIR.id) return; // Skip if no block exists or if it's an air block

        const blockLit = lightmap?.[x]?.[y] ? z >= lightmap[x][y] : true;
        const bH = block.fluid && (z == world.sz - 1 || !blocks[x][y][z+1].fluid) ? 0.9 : 1.0;

        // Ensure consistent vertex colors
        const color = block.selflit ? 1.0 : (blockLit ? 1.0 : 0.6);
        
        // Add small epsilon to prevent texture bleeding
        const eps = 0.001;
        
        // Adjust texture coordinates to prevent flickering
        const adjustTexture = (c) => {
            const padding = 0.000244140625; // 1/4096 for precise texture coordinates
            return [
                Math.min(c[0] + padding, c[2] - padding),
                Math.min(c[1] + padding, c[3] - padding),
                Math.max(c[0] + padding, c[2] - padding),
                Math.max(c[1] + padding, c[3] - padding)
            ];
        };

        // More precise vertex position snapping
        const snap = (v) => Math.round(v * 4096) / 4096;

        // Cache lightmap values
        const lightLevel = color;
        
        // Update the quad generation to use more precise coordinates
        const makeQuad = (positions, texCoords) => {
            return positions.map((pos, i) => [
                snap(pos[0]), snap(pos[1]), snap(pos[2]),
                texCoords[i][0], texCoords[i][1],
                lightLevel, lightLevel, lightLevel, 1.0
            ]);
        };

        // Top face
        if (z == world.sz - 1 || world.blocks[x][y][z+1].transparent || block.fluid) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.UP));
            const positions = [
                [x, y, z + bH],
                [x + 1, y, z + bH],
                [x + 1, y + 1, z + bH],
                [x, y + 1, z + bH]
            ];
            const texCoords = [
                [c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }
        
        // Bottom face
        if (z == 0 || world.blocks[x][y][z-1].transparent) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.DOWN));
            const positions = [
                [x, y + 1, z],
                [x + 1, y + 1, z],
                [x + 1, y, z],
                [x, y, z]
            ];
            const texCoords = [
                [c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }

        // Front face
        if (y == 0 || world.blocks[x][y-1][z].transparent) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.FORWARD));
            const positions = [
                [x, y, z],
                [x + 1, y, z],
                [x + 1, y, z + bH],
                [x, y, z + bH]
            ];
            const texCoords = [
                [c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }

        // Back face
        if (y == world.sy - 1 || world.blocks[x][y+1][z].transparent) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.BACK));
            const positions = [
                [x, y + 1, z + bH],
                [x + 1, y + 1, z + bH],
                [x + 1, y + 1, z],
                [x, y + 1, z]
            ];
            const texCoords = [
                [c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }

        // Left face
        if (x == 0 || world.blocks[x-1][y][z].transparent) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.LEFT));
            const positions = [
                [x, y, z + bH],
                [x, y + 1, z + bH],
                [x, y + 1, z],
                [x, y, z]
            ];
            const texCoords = [
                [c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }

        // Right face
        if (x == world.sx - 1 || world.blocks[x+1][y][z].transparent) {
            const c = adjustTexture(block.texture(world, lightmap, blockLit, x, y, z, DIRECTION.RIGHT));
            const positions = [
                [x + 1, y, z],
                [x + 1, y + 1, z],
                [x + 1, y + 1, z + bH],
                [x + 1, y, z + bH]
            ];
            const texCoords = [
                [c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]
            ];
            pushQuad(vertices, ...makeQuad(positions, texCoords));
        }
    },

    pushPickingVertices(vertices, x, y, z) {
        const color = { r: x/255, g: y/255, b: z/255 };
        
        // All six faces with unique picking colors
        [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.FORWARD, 
         DIRECTION.BACK, DIRECTION.LEFT, DIRECTION.RIGHT].forEach((dir, i) => {
            pushQuad(
                vertices,
                [x, y, z, 0, 0, color.r, color.g, color.b, (i+1)/255],
                [x + 1, y, z, 1, 0, color.r, color.g, color.b, (i+1)/255],
                [x + 1, y + 1, z, 1, 1, color.r, color.g, color.b, (i+1)/255],
                [x, y + 1, z, 0, 0, color.r, color.g, color.b, (i+1)/255]
            );
        });
    }
};

// Define block types

// Bedrock
BLOCK.BEDROCK = BLOCK.validateBlockType({
    id: 1,
    spawnable: false,
    transparent: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [1/16, 1/16, 2/16, 2/16]; 
    }
});

// Dirt
BLOCK.DIRT = BLOCK.validateBlockType({
    id: 2,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        let coords;
        if (dir == DIRECTION.UP && lit) {
            coords = [14/16, 0/16, 15/16, 1/16];
        } else if (dir == DIRECTION.DOWN || !lit) {
            coords = [2/16, 0/16, 3/16, 1/16];
        } else {
            coords = [3/16, 0/16, 4/16, 1/16];
        }
        return coords;
    }
});

// Wood
BLOCK.WOOD = BLOCK.validateBlockType({
    id: 3,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        if (dir == DIRECTION.UP || dir == DIRECTION.DOWN) {
            return [5/16, 1/16, 6/16, 2/16];
        } else {
            return [4/16, 1/16, 5/16, 2/16];
        }
    }
});

// TNT
BLOCK.TNT = BLOCK.validateBlockType({
    id: 4,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        if (dir == DIRECTION.UP || dir == DIRECTION.DOWN) {
            return [10/16, 0/16, 11/16, 1/16];
        } else {
            return [8/16, 0/16, 9/16, 1/16];
        }
    }
});

// Bookcase
BLOCK.BOOKCASE = BLOCK.validateBlockType({
    id: 5,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        if (dir == DIRECTION.FORWARD || dir == DIRECTION.BACK) {
            return [3/16, 2/16, 4/16, 3/16];
        } else {
            return [4/16, 0/16, 5/16, 1/16];
        }
    }
});

// Lava
BLOCK.LAVA = BLOCK.validateBlockType({
    id: 6,
    spawnable: false,
    transparent: true,
    selflit: true,
    gravity: true,
    fluid: true,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [13/16, 14/16, 14/16, 15/16]; 
    }
});

// Plank
BLOCK.PLANK = BLOCK.validateBlockType({
    id: 7,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [4/16, 0/16, 5/16, 1/16]; 
    }
});

// Cobblestone
BLOCK.COBBLESTONE = BLOCK.validateBlockType({
    id: 8,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [0/16, 1/16, 1/16, 2/16]; 
    }
});

// Concrete
BLOCK.CONCRETE = BLOCK.validateBlockType({
    id: 9,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [1/16, 0/16, 2/16, 1/16]; 
    }
});

// Brick
BLOCK.BRICK = BLOCK.validateBlockType({
    id: 10,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [7/16, 0/16, 8/16, 1/16]; 
    }
});

// Sand
BLOCK.SAND = BLOCK.validateBlockType({
    id: 11,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: true,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [2/16, 1/16, 3/16, 2/16]; 
    }
});

// Gravel
BLOCK.GRAVEL = BLOCK.validateBlockType({
    id: 12,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: true,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [3/16, 1/16, 4/16, 2/16]; 
    }
});

// Iron
BLOCK.IRON = BLOCK.validateBlockType({
    id: 13,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [6/16, 1/16, 7/16, 2/16]; 
    }
});

// Gold
BLOCK.GOLD = BLOCK.validateBlockType({
    id: 14,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [7/16, 1/16, 8/16, 2/16]; 
    }
});

// Diamond
BLOCK.DIAMOND = BLOCK.validateBlockType({
    id: 15,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [8/16, 1/16, 9/16, 2/16]; 
    }
});

// Obsidian
BLOCK.OBSIDIAN = BLOCK.validateBlockType({
    id: 16,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [5/16, 2/16, 6/16, 3/16]; 
    }
});

// Glass
BLOCK.GLASS = BLOCK.validateBlockType({
    id: 17,
    spawnable: true,
    transparent: true,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [1/16, 3/16, 2/16, 4/16]; 
    }
});

// Sponge
BLOCK.SPONGE = BLOCK.validateBlockType({
    id: 18,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) { 
        return [0/16, 3/16, 1/16, 4/16]; 
    }
});

// Define WATER block with clearer rendering
BLOCK.WATER = BLOCK.validateBlockType({
    id: 19,
    spawnable: false,
    transparent: true,
    selflit: false,
    gravity: true,
    fluid: true,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        // Use fixed texture coordinates for more visible water
        return [13/16, 12/16, 14/16, 13/16];
    }
});

// Define LEAVES block with better transparency
BLOCK.LEAVES = BLOCK.validateBlockType({
    id: 20,
    spawnable: true,
    transparent: true,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        return [4/16, 3/16, 5/16, 4/16];
    }
});

// Define ROCK block
BLOCK.ROCK = BLOCK.validateBlockType({
    id: 21,
    spawnable: true,
    transparent: false,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        return [2/16, 2/16, 3/16, 3/16];
    }
});

// Define AIR block
BLOCK.AIR = BLOCK.validateBlockType({
    id: 0,
    spawnable: false,
    transparent: true,
    selflit: false,
    gravity: false,
    fluid: false,
    texture: function(world, lightmap, lit, x, y, z, dir) {
        return [0, 0, 0, 0]; // No texture for air
    }
});

// Export
export { BLOCK, DIRECTION };