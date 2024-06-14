class HolyMap {
    static projection_types = [
        "AzimuthalEquidistant",
        "AzimuthalEqualArea",
        "Orthographic",
        "Equirectangular",
    ]
    static default_projection = "AzimuthalEquidistant"

    constructor(map_data, lines) {
        // This fixes the order of polygon points for d3 compatability
        this.geojson = rewind(map_data, true)
        this.lines = lines
        this.projection = d3.geoAzimuthalEquidistant()
        this.geo_generator = d3.geoPath().projection(this.projection)
        this.graticule = d3.geoGraticule()
        this.state = {
            type: HolyMap.default_projection,
            scale: 120,
            // Rotation-by-dragging parameters
            q0: null,
            v0: null,
            r0: null
        }

        const drag = d3
            .drag()
            .on("start", event => this.drag_started(event))
            .on("drag", event => this.dragged(event))

        d3.select("svg").call(drag)
        this.render()
    }

    set projection_type(projection_type) {
        this.state.type = projection_type
        this.projection = d3["geo" + this.state.type]()
        this.geo_generator.projection(this.projection)
        this.render()
    }

    reset_view() {
        this.state.scale = 120
        this.projection.rotate([0, 0, 0])
        this.render()
    }

    render() {
        // Update projection
        this.projection
            .scale(this.state.scale)
            .translate([600, 300])

        // Update world map
        let u = d3.select("g.map")
            .selectAll("path")
            .data(this.geojson.features)

        u.enter()
            .append("path")
            .merge(u)
            .attr("d", this.geo_generator)

        u = d3.select("g.lines")
            .selectAll("path")
            .data(this.lines)

        u.enter()
            .append("path")
            .merge(u)
            .attr("d", this.geo_generator)

        // Update projection center
        const projectedCenter = this.projection([0, 0])
        d3.select(".projection-center")
            .attr("cx", projectedCenter[0])
            .attr("cy", projectedCenter[1])

        // Update graticule
        d3.select(".graticule path")
            .datum(this.graticule())
            .attr("d", this.geo_generator)
    }

    drag_started(event) {
        this.state.v0 = versor.cartesian(this.projection.invert([event.x, event.y]))
        this.state.r0 = this.projection.rotate()
        this.state.q0 = versor(this.state.r0)
    }

    dragged(event) {
        const coordinates = this.projection.rotate(this.state.r0).invert([event.x, event.y])
        const v1 = versor.cartesian(coordinates)
        const q1 = versor.multiply(this.state.q0, versor.delta(this.state.v0, v1))
        const r1 = versor.rotation(q1)
        this.projection.rotate(r1)
        this.render()
    }
}

const lines = [
    {type: "LineString", coordinates: [[0.1278, 51.5074], [-74.0059, 40.7128]]},
    {type: "LineString", coordinates: [[34.851612, 31.046051], [24.6727135, -28.4792625]]},
    {type: "LineString", coordinates: [[34.851612, 31.046051],[144.948693002555, -37.854759842877925] ]}
]

// The agalega and st brandon dxcc is a multi polygon that is made of 2 ring,
// That I switched in order manually. This is most likly a bug in the rewind function.
d3.json("./dxcc.geojson").then(data => {
    const holy_map = new HolyMap(data, lines)

    d3.select("#menu")
        .selectAll(".slider.item input")
        .on("input", element => {
            holy_map.state.scale = element.target.value
            holy_map.render()
        })

    d3.select("#menu .projection-type select")
        .on("change", event => {
            holy_map.projection_type = event.target.options[event.target.selectedIndex].value
        })
        .selectAll("#menu .projection-type select option")
        .data(HolyMap.projection_types)
        .enter()
        .append("option")
        .attr("value", d => d)
        .text(d => d)

    d3.select("#menu .reset")
        .on("click", _ => holy_map.reset_view())
})
