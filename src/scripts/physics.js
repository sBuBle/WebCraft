// ==========================================
// Physics
//
// This class contains the code that takes care of simulating
// processes like gravity and fluid flow in the world.
// ==========================================

import { BLOCK } from './blocks.js'; // Ensure BLOCK is imported

// Constructor()
//
// Creates a new physics simulator.

class Physics {
	constructor() {
		this.lastStep = -1;
	}

	// setWorld( world )
	//
	// Assigns a world to simulate to this physics simulator.

	setWorld(world) {
		this.world = world;
	}

	// simulate()
	//
	// Perform one iteration of physics simulation.
	// Should be called about once every second.

	simulate() {
		const world = this.world;
		const blocks = world.blocks;

		const step = Math.floor(new Date().getTime() / 100);
		if (step === this.lastStep) return;
		this.lastStep = step;

		// Gravity
		if (step % 1 === 0) {
			for (let x = 0; x < world.sx; x++) {
				for (let y = 0; y < world.sy; y++) {
					for (let z = 0; z < world.sz; z++) {
						const block = blocks[x][y][z];
						if (block?.gravity && z > 0 && !blocks[x][y][z-1]) {
							world.setBlock(x, y, z - 1, block);
							world.setBlock(x, y, z, null);
						}
					}
				}
			}
		}

		// Fluids
		if (step % 10 === 0) {
			// Newly spawned fluid blocks are stored so that those aren't
			// updated in the same step, creating a simulation avalanche.
			const newFluidBlocks = {};

			for (let x = 0; x < world.sx; x++) {
				for (let y = 0; y < world.sy; y++) {
					for (let z = 0; z < world.sz; z++) {
						const block = blocks[x][y][z];
						if (block?.fluid && newFluidBlocks[`${x},${y},${z}`] == null) {
							if (x > 0 && !blocks[x - 1][y][z]) {
								world.setBlock(x - 1, y, z, block);
								newFluidBlocks[`${x - 1},${y},${z}`] = true;
							}
							if (x < world.sx - 1 && !blocks[x + 1][y][z]) {
								world.setBlock(x + 1, y, z, block);
								newFluidBlocks[`${x + 1},${y},${z}`] = true;
							}
							if (y > 0 && !blocks[x][y - 1][z]) {
								world.setBlock(x, y - 1, z, block);
								newFluidBlocks[`${x},${y - 1},${z}`] = true;
							}
							if (y < world.sy - 1 && !blocks[x][y + 1][z]) {
								world.setBlock(x, y + 1, z, block);
								newFluidBlocks[`${x},${y + 1},${z}`] = true;
							}
						}
					}
				}
			}
		}
	}
}

// Export to node.js
if (typeof exports !== "undefined") {
	exports.Physics = Physics;
}