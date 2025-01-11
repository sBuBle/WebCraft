class PerlinNoise {
    #perm;
    #permMod;
    
    // Preallocate vectors as static to share across instances
    static #vectorTable = new Float64Array([
        1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
        1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
        0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
    ]);
    
    static #DEFAULT_PERMUTATION = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142,
        8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
        57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166,
        77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
        65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
        164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
        207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70,
        221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
        218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239,
        107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236,
        205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
    
    constructor() {
        // Combine perm and permMod into single TypedArray for better cache locality
        const buffer = new ArrayBuffer(1024);
        this.#perm = new Uint16Array(buffer, 0, 512);
        this.#permMod = new Uint8Array(this.#perm.buffer);
        
        // Unroll initialization loop for better performance
        let i = 0;
        while (i < 256) {
            const val = PerlinNoise.#DEFAULT_PERMUTATION[i];
            this.#perm[i] = this.#perm[i + 256] = val;
            this.#permMod[i] = this.#permMod[i + 256] = val & 255;
            i++;
        }
    }

    noise3D = (() => {
        // Preallocate computation arrays
        const vec = new Float64Array(3);
        
        return (x, y, z) => {
            // Fast floor using bitwise operations
            const X = ~~x & 255;
            const Y = ~~y & 255;
            const Z = ~~z & 255;
            
            // Relative coordinates with single operation
            x -= ~~x;
            y -= ~~y;
            z -= ~~z;
            
            // Faster fade computation
            const u = x * x * x * (x * (x * 6 - 15) + 10);
            const v = y * y * y * (y * (y * 6 - 15) + 10);
            const w = z * z * z * (z * (z * 6 - 15) + 10);

            // Optimize hash computation
            const A = (this.#permMod[X] + Y) & 255;
            const AA = (this.#permMod[A] + Z) & 255;
            const AB = (this.#permMod[A + 1] + Z) & 255;
            const B = (this.#permMod[X + 1] + Y) & 255;
            const BA = (this.#permMod[B] + Z) & 255;
            const BB = (this.#permMod[B + 1] + Z) & 255;

            // Inline gradient computations
            return this.lerp(w,
                this.lerp(v,
                    this.lerp(u,
                        this.fastGrad(this.#perm[AA], x, y, z),
                        this.fastGrad(this.#perm[BA], x - 1, y, z)
                    ),
                    this.lerp(u,
                        this.fastGrad(this.#perm[AB], x, y - 1, z),
                        this.fastGrad(this.#perm[BB], x - 1, y - 1, z)
                    )
                ),
                this.lerp(v,
                    this.lerp(u,
                        this.fastGrad(this.#perm[AA + 1], x, y, z - 1),
                        this.fastGrad(this.#perm[BA + 1], x - 1, y, z - 1)
                    ),
                    this.lerp(u,
                        this.fastGrad(this.#perm[AB + 1], x, y - 1, z - 1),
                        this.fastGrad(this.#perm[BB + 1], x - 1, y - 1, z - 1)
                    )
                )
            );
        };
    })();

    // Optimized linear interpolation
    lerp = (t, a, b) => a + t * (b - a);

    // Fast gradient computation using lookup table
    fastGrad = (hash, x, y, z) => {
        const h = hash & 15;
        const index = h * 3;
        return PerlinNoise.#vectorTable[index] * x + 
               PerlinNoise.#vectorTable[index + 1] * y + 
               PerlinNoise.#vectorTable[index + 2] * z;
    };

    dispose() {
        this.#perm = null;
        this.#permMod = null;
    }
}

export default PerlinNoise;
