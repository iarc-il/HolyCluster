export class Dimensions {
    constructor(width, height, inner_padding) {
        this.width = width;
        this.height = height;
        this.inner_padding = inner_padding;

        this.center_x = width / 2;
        this.center_y = height / 2;
        this.radius = Math.min(this.center_x, this.center_y) - inner_padding;

        this.padded_size = [width - inner_padding * 2, height - inner_padding * 2];
        this.scale = Math.max(Math.min(height / 900, 1.1), 0.5);
    }
}
