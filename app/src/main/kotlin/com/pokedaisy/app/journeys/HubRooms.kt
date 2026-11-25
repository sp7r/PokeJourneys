package com.pokedaisy.app.journeys

import java.io.File
import java.io.RandomAccessFile
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Victory Island's rooms, built from the player's cartridges: the Kotlin form of tools/hub/victory/interiors.js and
 * interiors-bw.js (with glb-to-obj.js, heights.js, interior-walk.js), which the PC keeps as the reference. Same
 * output, file for file; it runs here because the phone's JavaScript engine takes minutes over what this does in
 * seconds. apicula still converts the models, several at once. Plain JVM code, so a unit test runs it on a PC.
 */
object HubRooms {

    /**
     * Builds every room in [roomsJson] (tools/hub/build/rooms.json) into [data]/interiors. [heightsJs] is
     * tools/hub/victory/heights.js, whose Black 2 distance table this reads rather than keeping a second copy.
     */
    fun build(roms: Map<String, File>, roomsJson: File, heightsJs: File, apicula: File, data: File, work: File, log: (String) -> Unit = {}) {
        Heights.distanceSource = { heightsJs.readText() }
        @Suppress("UNCHECKED_CAST")
        val rooms = Json.parse(roomsJson.readText()) as Map<String, List<Map<String, Any?>>>
        work.deleteRecursively(); work.mkdirs()
        val pool = Executors.newFixedThreadPool(max(2, Runtime.getRuntime().availableProcessors()))
        try {
            for (game in listOf("platinum", "heartgold", "black2")) {
                val specs = rooms[game] ?: continue
                Rom(roms.getValue(game)).use { rom ->
                    val converter = Converter(apicula, File(work, game), pool)
                    if (rom.code.startsWith("IRE")) Gen5(rom, converter).export(specs, data, log)
                    else Gen4(rom, converter).export(specs, data, log)
                }
            }
        } finally { pool.shutdownNow() }
        work.deleteRecursively()
    }

    // ---- cartridge files ----

    class Rom(file: File) : AutoCloseable {
        private val raf = RandomAccessFile(file, "r")
        private val files = HashMap<String, LongArray>()
        val code: String
        init {
            val head = read(0, 0x200)
            code = String(head, 0x0c, 4, Charsets.ISO_8859_1)
            val fnt = read(u32(head, 0x40), u32(head, 0x44).toInt())
            val fatOffset = u32(head, 0x48); val fat = read(fatOffset, u32(head, 0x4c).toInt())
            fun walk(dirId: Int, prefix: String) {
                val entry = (dirId and 0xfff) * 8
                var pos = u32(fnt, entry).toInt(); var fileId = u16(fnt, entry + 4)
                while (true) {
                    val len = fnt[pos++].toInt() and 255
                    if (len == 0) break
                    val name = String(fnt, pos, len and 0x7f, Charsets.ISO_8859_1); pos += len and 0x7f
                    if (len and 0x80 != 0) { val sub = u16(fnt, pos); pos += 2; walk(sub, "$prefix$name/") }
                    else { files["$prefix$name"] = longArrayOf(u32(fat, fileId * 8), u32(fat, fileId * 8 + 4)); fileId++ }
                }
            }
            walk(0xf000, "")
        }
        fun read(at: Long, n: Int): ByteArray = ByteArray(n).also { raf.seek(at); raf.readFully(it) }
        fun file(path: String): ByteArray { val r = files[path] ?: error("Missing ROM file $path"); return read(r[0], (r[1] - r[0]).toInt()) }
        /** Where a file is in the cartridge: its offset and length. */
        fun place(path: String): LongArray { val r = files[path] ?: error("Missing ROM file $path"); return longArrayOf(r[0], r[1] - r[0]) }
        fun narc(path: String): List<ByteArray> = readNarc(file(path))
        override fun close() = raf.close()
    }

    fun readNarc(buf: ByteArray): List<ByteArray> {
        require(String(buf, 0, 4, Charsets.ISO_8859_1) == "NARC") { "not a NARC" }
        var pos = u16(buf, 0x0c)
        require(String(buf, pos, 4, Charsets.ISO_8859_1) == "BTAF") { "no BTAF" }
        val btafSize = u32(buf, pos + 4).toInt(); val count = u16(buf, pos + 8)
        val ranges = (0 until count).map { u32(buf, pos + 12 + it * 8).toInt() to u32(buf, pos + 16 + it * 8).toInt() }
        pos += btafSize
        pos += u32(buf, pos + 4).toInt()
        val data = pos + 8
        return ranges.map { (s, e) -> buf.copyOfRange(data + s, data + e) }
    }

    // ---- apicula, several conversions at once; each distinct model converted once ----

    class Converter(private val apicula: File, private val dir: File, private val pool: java.util.concurrent.ExecutorService) {
        private val jobs = LinkedHashMap<String, Future<File>>()
        /** Queues a model and texture set for conversion; [key] names the pair. */
        fun queue(key: String, model: ByteArray, textures: ByteArray) {
            if (key in jobs) return
            val folder = File(dir, key.replace(Regex("[^A-Za-z0-9_-]"), "_"))
            jobs[key] = pool.submit<File> {
                folder.deleteRecursively(); folder.mkdirs()
                val m = File(folder, "model.nsbmd").apply { writeBytes(model) }
                val t = File(folder, "textures.nsbtx").apply { writeBytes(textures) }
                val out = File(folder, "out")
                val err = File(folder, "apicula.log")
                val p = ProcessBuilder(apicula.path, "convert", m.path, t.path, "-o", out.path, "-f", "glb", "--overwrite")
                    .redirectErrorStream(true).redirectOutput(err).start()
                p.outputStream.close()
                check(p.waitFor() == 0) { "apicula convert failed for $key: " + err.readText().takeLast(400) }
                out.listFiles().orEmpty().filter { it.name.endsWith(".glb") }.minByOrNull { it.name } ?: error("No converted model $key")
            }
        }
        fun glb(key: String): File = jobs.getValue(key).get()
    }

    // ---- a converted model as the hub's OBJ (glb-to-obj.js convert, then interiors.js model) ----

    class Mesh(val file: String, val groups: List<Pair<String, List<DoubleArray>>>)

    /** Writes [name].obj/.mtl and its textures into [dir]; adds its materials. Returns the triangles by material, as readObj gives them. */
    fun model(glb: File, dir: File, name: String, materials: MutableMap<String, Any?>, position: DoubleArray, rotation: DoubleArray, scale: DoubleArray): Mesh {
        if (rotation[0] != 0.0 || rotation[2] != 0.0) error("Unsupported prop rotation: " + rotation.joinToString(","))
        val g = Glb.geometry(glb)
        val s = 1.0 / 16
        val angle = rotation[1] * Math.PI / 180
        val ca = StrictMath.cos(angle); val sa = StrictMath.sin(angle)
        val ds = g.verts.map { (x, y, z) -> val rx = x * ca + z * sa; val rz = -x * sa + z * ca; doubleArrayOf(rx * s, -rz * s, y * s) }
        val lo = DoubleArray(3) { Double.POSITIVE_INFINITY }; val hi = DoubleArray(3) { Double.NEGATIVE_INFINITY }
        for (v in ds) for (k in 0..2) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k] }
        val (minX, minY, minZ) = lo; val maxX = hi[0]; val maxY = hi[1]
        val w = min(6.0, max(1.0, ceil(maxX - minX - 0.05))); val h = min(6.0, max(1.0, ceil(maxY - minY - 0.05)))
        val ox = (w - (maxX - minX)) / 2 - minX; val oy = (h - (maxY - minY)) / 2 - minY
        dir.mkdirs()
        val mats = g.materials.mapIndexed { i, m -> "${name}_" + ((m["name"] as String?)?.ifEmpty { null } ?: "m$i").replace(Regex("[^A-Za-z0-9_]"), "_") to Glb.image(g.gltf, m) }
        val mtl = StringBuilder()
        for ((matName, img) in mats) {
            if (img == null) continue
            val dst = "${name}_$img"
            File(glb.parentFile, img).copyTo(File(dir, dst), overwrite = true)
            mtl.append("newmtl $matName\nmap_Kd $dst\nmap_d $dst\n\n")
        }
        val obj = StringBuilder("mtllib $name.mtl\no $name\n")
        val placed = ArrayList<DoubleArray>(ds.size)
        val zShift = min(0.0, minZ) * 0
        for (v in ds) {
            // interiors.js reads the converter's 4-place text back, then places it at 5 places
            val x = fixed(v[0] + ox, 4).toDouble(); val y = fixed(v[1] + oy, 4).toDouble(); val z = fixed(v[2] - zShift, 4).toDouble()
            val p = arrayOf(fixed((x - ox) * scale[0] + position[0], 5), fixed((y - oy) * scale[2] - position[2], 5), fixed(z * scale[1] + position[1], 5))
            obj.append("v ").append(p[0]).append(' ').append(p[1]).append(' ').append(p[2]).append('\n')
            placed += doubleArrayOf(p[0].toDouble(), p[2].toDouble(), -p[1].toDouble())
        }
        for (t in g.uvs) obj.append("vt ").append(fixed(t[0], 5)).append(' ').append(fixed(t[1], 5)).append('\n')
        for ((_, f) in g.faces) {
            val a = ds[f[0][0]]; val b = ds[f[1][0]]; val c = ds[f[2][0]]
            val u = doubleArrayOf(b[0] - a[0], b[1] - a[1], b[2] - a[2]); val q = doubleArrayOf(c[0] - a[0], c[1] - a[1], c[2] - a[2])
            val n = doubleArrayOf(u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0])
            val l = hypot(n).let { if (it == 0.0 || it.isNaN()) 1.0 else it }
            obj.append("vn ").append(fixed(n[0] / l, 4)).append(' ').append(fixed(n[1] / l, 4)).append(' ').append(fixed(n[2] / l, 4)).append('\n')
        }
        val groups = LinkedHashMap<String, MutableList<DoubleArray>>()
        var current: String? = null
        g.faces.forEachIndexed { i, (m, f) ->
            val mat = mats.getOrNull(m) ?: return@forEachIndexed
            if (mat.second == null) return@forEachIndexed
            if (mat.first != current) { obj.append("usemtl ").append(mat.first).append('\n'); current = mat.first }
            obj.append("f ").append(f.joinToString(" ") { "${it[0] + 1}/${it[1] + 1}/${i + 1}" }).append('\n')
            val list = groups.getOrPut(mat.first) { ArrayList() }
            for (k in 0..2) list += placed[f[k][0]]
        }
        File(dir, "$name.obj").writeText(obj.toString())
        File(dir, "$name.mtl").writeText(mtl.toString())
        for ((i, m) in g.materials.withIndex()) {
            val key = "${name}_" + ((m["name"] as String?)?.ifEmpty { null } ?: "m$i").replace(Regex("[^A-Za-z0-9_]"), "_")
            val blend = m["alphaMode"] == "BLEND"
            @Suppress("UNCHECKED_CAST")
            val color = (m["pbrMetallicRoughness"] as Map<String, Any?>?)?.get("baseColorFactor") ?: listOf(1.0, 1.0, 1.0, 1.0)
            materials[key] = linkedMapOf("lift" to if (blend) 0.002 else 0.0, "transparency" to if (blend) 1.0 else 2.0,
                "scissor" to (m["alphaCutoff"] ?: 0.5), "cull" to 2.0, "shading" to 0.0, "color" to color)
        }
        return Mesh("$name.obj", groups.map { it.key to it.value })
    }

    object Glb {
        class Geometry(val gltf: Map<String, Any?>, val materials: List<Map<String, Any?>>, val verts: List<DoubleArray>, val uvs: List<DoubleArray>, val faces: List<Pair<Int, Array<IntArray>>>)

        @Suppress("UNCHECKED_CAST")
        fun image(gltf: Map<String, Any?>, m: Map<String, Any?>): String? {
            val tex = ((m["pbrMetallicRoughness"] as Map<String, Any?>?)?.get("baseColorTexture") as Map<String, Any?>?) ?: return null
            val t = (gltf["textures"] as List<Map<String, Any?>>)[num(tex["index"])]
            return (gltf["images"] as List<Map<String, Any?>>)[num(t["source"])]["uri"] as String
        }

        @Suppress("UNCHECKED_CAST")
        fun geometry(file: File): Geometry {
            val buf = file.readBytes()
            val jsonLen = u32(buf, 12).toInt()
            val gltf = Json.parse(String(buf, 20, jsonLen, Charsets.UTF_8)) as Map<String, Any?>
            val binStart = 20 + jsonLen + 8; val bin = buf.copyOfRange(binStart, binStart + u32(buf, 20 + jsonLen).toInt())
            val nodes = gltf["nodes"] as List<Map<String, Any?>>
            val parent = IntArray(nodes.size) { -1 }
            nodes.forEachIndexed { i, n -> (n["children"] as List<Any?>?)?.forEach { parent[num(it)] = i } }
            val world = arrayOfNulls<DoubleArray>(nodes.size)
            fun globalOf(i: Int): DoubleArray = world[i] ?: (if (parent[i] < 0) local(nodes[i]) else mul(globalOf(parent[i]), local(nodes[i]))).also { world[i] = it }
            val verts = ArrayList<DoubleArray>(); val uvs = ArrayList<DoubleArray>(); val faces = ArrayList<Pair<Int, Array<IntArray>>>()
            val meshes = gltf["meshes"] as List<Map<String, Any?>>
            nodes.forEachIndexed { ni, node ->
                val meshIndex = node["mesh"] ?: return@forEachIndexed
                val skin = node["skin"]?.let { (gltf["skins"] as List<Map<String, Any?>>)[num(it)] }
                val jointMats = skin?.let { sk -> (sk["joints"] as List<Any?>).mapIndexed { k, j ->
                    mul(globalOf(num(j)), sk["inverseBindMatrices"]?.let { accessor(gltf, bin, num(it))[k] } ?: ident()) } }
                val nodeMat = if (skin != null) null else globalOf(ni)
                for (p in (meshes[num(meshIndex)]["primitives"] as List<Map<String, Any?>>)) {
                    if (p["mode"] != null && num(p["mode"]) != 4) continue
                    val attrs = p["attributes"] as Map<String, Any?>
                    val pos = accessor(gltf, bin, num(attrs["POSITION"]))
                    val uv = attrs["TEXCOORD_0"]?.let { accessor(gltf, bin, num(it)) } ?: pos.map { doubleArrayOf(0.0, 0.0) }
                    val joints = if (skin != null) attrs["JOINTS_0"]?.let { accessor(gltf, bin, num(it)) } else null
                    val weights = if (skin != null) attrs["WEIGHTS_0"]?.let { accessor(gltf, bin, num(it)) } else null
                    val idx = p["indices"]?.let { accessor(gltf, bin, num(it)).map { v -> v[0].toInt() } } ?: pos.indices.toList()
                    val v0 = verts.size; val t0 = uvs.size
                    pos.forEachIndexed { i, v ->
                        if (joints != null) {
                            var w0 = 0.0; var w1 = 0.0; var w2 = 0.0
                            for (k in 0..3) {
                                val wt = weights!![i][k]; if (wt == 0.0 || wt.isNaN()) continue
                                val q = apply(jointMats!![joints[i][k].toInt()], v)
                                w0 += q[0] * wt; w1 += q[1] * wt; w2 += q[2] * wt
                            }
                            verts += doubleArrayOf(w0, w1, w2)
                        } else verts += apply(nodeMat!!, v)
                    }
                    uv.forEach { uvs += doubleArrayOf(it[0], 1 - it[1]) }
                    val material = p["material"]?.let { num(it) } ?: -1
                    var i = 0
                    while (i + 2 < idx.size) { faces += material to Array(3) { k -> intArrayOf(v0 + idx[i + k], t0 + idx[i + k]) }; i += 3 }
                }
            }
            if (verts.isEmpty()) error("no geometry in $file")
            return Geometry(gltf, (gltf["materials"] as List<Map<String, Any?>>?).orEmpty(), verts, uvs, faces)
        }

        @Suppress("UNCHECKED_CAST")
        private fun accessor(gltf: Map<String, Any?>, bin: ByteArray, index: Int): List<DoubleArray> {
            val a = (gltf["accessors"] as List<Map<String, Any?>>)[index]
            val bv = (gltf["bufferViews"] as List<Map<String, Any?>>)[num(a["bufferView"])]
            val type = num(a["componentType"]); val bytes = when (type) { 5120, 5121 -> 1; 5122, 5123 -> 2; else -> 4 }
            val n = when (a["type"]) { "SCALAR" -> 1; "VEC2" -> 2; "VEC3" -> 3; "VEC4" -> 4; else -> 16 }
            val stride = (bv["byteStride"]?.let { num(it) } ?: 0).let { if (it == 0) bytes * n else it }
            val base = (bv["byteOffset"]?.let { num(it) } ?: 0) + (a["byteOffset"]?.let { num(it) } ?: 0)
            val normalized = a["normalized"] == true
            return List(num(a["count"])) { i -> DoubleArray(n) { k ->
                val o = base + i * stride + k * bytes
                var x = when (type) {
                    5126 -> java.lang.Float.intBitsToFloat(u32(bin, o).toInt()).toDouble()
                    5123 -> u16(bin, o).toDouble(); 5125 -> u32(bin, o).toDouble(); 5121 -> (bin[o].toInt() and 255).toDouble()
                    5122 -> s16(bin, o).toDouble(); else -> bin[o].toDouble()
                }
                if (normalized && type != 5126) x /= when (type) { 5121 -> 255.0; 5123 -> 65535.0; 5122 -> 32767.0; else -> 127.0 }
                x
            } }
        }

        private fun ident() = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        private fun mul(a: DoubleArray, b: DoubleArray): DoubleArray {
            val o = DoubleArray(16)
            for (c in 0..3) for (r in 0..3) for (k in 0..3) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
            return o
        }
        private fun apply(m: DoubleArray, v: DoubleArray) = doubleArrayOf(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14])
        @Suppress("UNCHECKED_CAST")
        private fun local(node: Map<String, Any?>): DoubleArray {
            (node["matrix"] as List<Any?>?)?.let { m -> return DoubleArray(16) { dbl(m[it]) } }
            val t = (node["translation"] as List<Any?>?)?.map(::dbl) ?: listOf(0.0, 0.0, 0.0)
            val q = (node["rotation"] as List<Any?>?)?.map(::dbl) ?: listOf(0.0, 0.0, 0.0, 1.0)
            val s = (node["scale"] as List<Any?>?)?.map(::dbl) ?: listOf(1.0, 1.0, 1.0)
            val (qx, qy, qz, qw) = q
            val r = doubleArrayOf(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0.0,
                2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0.0,
                2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0.0, 0.0, 0.0, 0.0, 1.0)
            return doubleArrayOf(r[0] * s[0], r[1] * s[0], r[2] * s[0], 0.0, r[4] * s[1], r[5] * s[1], r[6] * s[1], 0.0,
                r[8] * s[2], r[9] * s[2], r[10] * s[2], 0.0, t[0], t[1], t[2], 1.0)
        }
    }

    // ---- walking: heights from the cartridge, feet on the visible floor (interior-walk.js) ----

    private class Tri(val a: DoubleArray, val e1: DoubleArray, val e2: DoubleArray, val det: Double, val shadow: Boolean)

    private fun meshIndex(meshes: List<Mesh>): HashMap<Long, MutableList<Tri>> {
        val bins = HashMap<Long, MutableList<Tri>>()
        val shadow = Regex("kage|shadow", RegexOption.IGNORE_CASE)
        for (mesh in meshes) for ((name, vs) in mesh.groups) {
            val isShadow = shadow.containsMatchIn(name)
            var i = 0
            while (i + 2 < vs.size) {
                val a = vs[i]; val b = vs[i + 1]; val c = vs[i + 2]; i += 3
                val e1 = doubleArrayOf(b[0] - a[0], b[1] - a[1], b[2] - a[2]); val e2 = doubleArrayOf(c[0] - a[0], c[1] - a[1], c[2] - a[2])
                val t = Tri(a, e1, e2, e1[0] * e2[2] - e1[2] * e2[0], isShadow)
                val x0 = floor(min(a[0], min(b[0], c[0])) + 15.5).toInt(); val x1 = floor(max(a[0], max(b[0], c[0])) + 15.5).toInt()
                val y0 = floor(min(a[2], min(b[2], c[2])) + 15.5).toInt(); val y1 = floor(max(a[2], max(b[2], c[2])) + 15.5).toInt()
                for (y in y0..y1) for (x in x0..x1) bins.getOrPut(key(x, y)) { ArrayList() } += t
            }
        }
        return bins
    }
    private fun key(x: Int, y: Int) = (x.toLong() shl 32) xor (y.toLong() and 0xffffffffL)

    private class Walk(val connections: List<IntArray>, val stepHeights: Map<String, Any?>, val corrections: List<Any?>)

    private fun roomWalk(meshes: List<Mesh>, types: List<String>, heights: Array<DoubleArray>): Walk {
        val terrain = meshIndex(meshes.filter { it.file.startsWith("map") })
        fun sample(x: Double, y: Double, expected: Double): Double {
            var best = expected; var distance = 0.51
            for (t in terrain[key(floor(x).toInt(), floor(y).toInt())].orEmpty()) {
                if (abs(t.det) < 1e-8 || t.shadow) continue
                val xx = x - 15.5 - t.a[0]; val yy = y - 15.5 - t.a[2]
                val u = (xx * t.e2[2] - yy * t.e2[0]) / t.det; val v = (yy * t.e1[0] - xx * t.e1[2]) / t.det
                if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue
                val h = t.a[1] + u * t.e1[1] + v * t.e2[1]; val delta = abs(h - expected)
                if (delta < distance) { best = h; distance = delta }
            }
            return round3(best)
        }
        val corrections = ArrayList<Any?>(); val rows = types.size; val cols = types[0].length
        for (y in 0 until rows) for (x in 0 until cols) if (types[y][x] != '#') {
            val previous = heights[y][x]; val height = sample(x.toDouble(), y.toDouble(), previous)
            if (abs(previous - height) > 0.02) corrections += linkedMapOf("tile" to listOf(x.toDouble(), y.toDouble()), "permission" to previous, "surface" to height)
            heights[y][x] = height
        }
        val connections = List(rows) { IntArray(cols) }; val stepHeights = LinkedHashMap<String, Any?>()
        val dirs = arrayOf(intArrayOf(0, -1), intArrayOf(0, 1), intArrayOf(-1, 0), intArrayOf(1, 0))
        for (y in 0 until rows) for (x in 0 until cols) if (types[y][x] != '#') for (d in 0..3) {
            val (dx, dy) = dirs[d]; val xx = x + dx; val yy = y + dy
            if (xx < 0 || yy < 0 || xx >= cols || yy >= rows || types[yy][xx] == '#') continue
            val h0 = heights[y][x]; val h1 = heights[yy][xx]
            val profile = doubleArrayOf(.25, .5, .75).map { t -> sample(x + dx * t, y + dy * t, h0 + (h1 - h0) * t) }
            val all = listOf(h0) + profile + h1
            if (abs(h0 - h1) > 1.01 || (1 until all.size).any { abs(all[it] - all[it - 1]) > .76 }) continue
            connections[y][x] = connections[y][x] or (1 shl d)
            if (all.any { abs(it - h0) > .002 }) stepHeights["$x,$y,$d"] = profile
        }
        return Walk(connections, stepHeights, corrections)
    }

    private fun writeRoom(dir: File, materials: Map<String, Any?>, meshes: List<Mesh>, walk: Map<String, Any?>, room: Map<String, Any?>) {
        for (m in meshes) for ((name, _) in m.groups) if (name !in materials) error("Unmapped material $name")
        File(dir, "materials.json").writeText(Json.write(materials) + "\n")
        File(dir, "walk.json").writeText(Json.write(walk) + "\n")
        File(dir, "room.json").writeText(Json.write(room) + "\n")
    }

    private fun walkJson(cols: Int, rows: Int, types: List<String>, heights: Array<DoubleArray>, w: Walk, spawn: List<Double>) = linkedMapOf(
        "cols" to cols.toDouble(), "rows" to rows.toDouble(), "types" to types, "heights" to heights.map { r -> r.toList() },
        "connections" to w.connections.map { r -> r.map { it.toDouble() } }, "stepHeights" to w.stepHeights, "spawn" to spawn)

    private fun extras(spec: Map<String, Any?>) = buildMap<String, Any?> { spec["links"]?.let { put("links", it) }; spec["mirror"]?.let { put("mirror", it) } }

    // ---- generation four: Platinum and HeartGold (interiors.js) ----

    private class Gen4(val rom: Rom, val conv: Converter) {
        val hg = rom.code == "IPKE"
        init { if (!hg && rom.code != "CPUE") error("Expected US Platinum or HeartGold, got ${rom.code}") }

        fun export(specs: List<Map<String, Any?>>, data: File, log: (String) -> Unit) {
            val lands = rom.narc(if (hg) "a/0/6/5" else "fielddata/land_data/land_data.narc")
            val matrices = rom.narc(if (hg) "a/0/4/1" else "fielddata/mapmatrix/map_matrix.narc")
            val areas = rom.narc(if (hg) "a/0/4/2" else "fielddata/areadata/area_data.narc")
            val textures = rom.narc(if (hg) "a/0/4/4" else "fielddata/areadata/area_map_tex/map_tex_set.narc")
            val props = rom.narc(if (hg) "fielddata/build_model/bm_room.narc" else "fielddata/build_model/build_model.narc")
            val propTextures = rom.narc(if (hg) "a/0/7/0" else "fielddata/areadata/area_build_model/areabm_texset.narc")
            val events = rom.narc(if (hg) "a/0/3/2" else "fielddata/eventdata/zone_event.narc")
            val arm9At = u32(rom.read(0x20, 4), 0); val arm9 = rom.read(arm9At, u32(rom.read(0x2c, 4), 0).toInt())
            // headers: Platinum's table sits in the ARM9 as stored (offsets from the cartridge start); HeartGold's in the expanded ARM9
            val (arm, base, table) = if (hg) expandArm9(arm9).let { Triple(it, 0L, heartgoldTable(it)) } else Triple(arm9, arm9At, platinumTable(arm9, arm9At))
            class Plan(val spec: Map<String, Any?>, val h: ByteArray, val m: Matrix, val textureId: Int, val propSet: Int)
            val plans = specs.map { spec ->
                val zone = num(spec["zone"]); val room = spec["room"] as String
                if (zone < 0 || zone > 600 || !Regex("^[-a-z0-9_]+$").matches(room)) error("Invalid room definition")
                val at = (table + zone * 24 - base).toInt(); val h = arm.copyOfRange(at, at + 24)
                val m = matrix(matrices[u16(h, if (hg) 4 else 2)]); val a = areas[h[if (hg) 1 else 0].toInt() and 255]
                Plan(spec, h, m, u16(a, 2), u16(a, 0))
            }
            // every model the rooms need, converted together
            for (p in plans) for (landId in p.m.lands) if (landId != 65535) {
                val land = lands[landId]; val sizes = IntArray(4) { u32(land, it * 4).toInt() }; val lh = if (hg) 20 else 16
                conv.queue("map-$landId-${p.textureId}", land.copyOfRange(lh + sizes[0] + sizes[1], lh + sizes[0] + sizes[1] + sizes[2]), textures[p.textureId])
                val propBytes = land.copyOfRange(lh + sizes[0], lh + sizes[0] + sizes[1])
                for (q in 0 until propBytes.size step 48) { val id = u32(propBytes, q).toInt(); conv.queue("prop-$id-${p.propSet}", props[id], propTextures[p.propSet]) }
            }
            for (p in plans) {
                val spec = p.spec; val room = spec["room"] as String; val zone = num(spec["zone"]); val h = p.h; val m = p.m
                val matrixId = u16(h, if (hg) 4 else 2); val areaId = h[if (hg) 1 else 0].toInt() and 255; val eventId = u16(h, 16)
                val exits = warps(events[eventId])
                if (exits.isEmpty() || (exits.size != 1 && spec["warp"] == null)) error("Select an entrance warp in $room")
                val selected = ((spec["exitWarps"] as List<Any?>?) ?: listOf(spec["warp"] ?: 0.0)).map { exits[num(it)] }
                val exitFacing = (spec["exitFacing"] as List<Any?>?)?.map(::dbl) ?: listOf(0.0, 1.0)
                val cols = m.cols * 32; val rows = m.rows * 32
                val heights = Array(rows) { DoubleArray(cols) }; val typeRows = Array(rows) { CharArray(cols) { '#' } }
                val dir = File(data, "interiors/$room").apply { mkdirs() }
                val materials = LinkedHashMap<String, Any?>(); val meshes = ArrayList<Mesh>(); val placed = ArrayList<Any?>()
                for ((cell, landId) in m.lands.withIndex()) {
                    if (landId == 65535) continue
                    val cellX = cell % m.cols; val cellY = cell / m.cols; val offset = doubleArrayOf(cellX * 32.0, 0.0, cellY * 32.0)
                    val land = lands[landId]; val sizes = IntArray(4) { u32(land, it * 4).toInt() }; val lh = if (hg) 20 else 16
                    val (permissionsSize, propsSize, _, bdhcSize) = sizes.toList()
                    if (permissionsSize != 2048 || propsSize % 48 != 0 || lh + sizes.sum() != land.size) error("Invalid land sections")
                    val permissions = land.copyOfRange(lh, lh + permissionsSize); val propBytes = land.copyOfRange(lh + permissionsSize, lh + permissionsSize + propsSize)
                    meshes += model(conv.glb("map-$landId-${p.textureId}"), dir, "map-$cell", materials, offset, DoubleArray(3), doubleArrayOf(1.0, 1.0, 1.0))
                    for (q in 0 until propBytes.size step 48) {
                        val id = u32(propBytes, q).toInt()
                        val position = intArrayOf(4, 8, 12).map { s32(propBytes, it + q) / 65536.0 }
                        val rotation = intArrayOf(16, 20, 24).map { s32(propBytes, it + q) / 4096.0 }
                        val scale = intArrayOf(28, 32, 36).map { s32(propBytes, it + q) / 4096.0 }
                        val name = "furniture-$cell-" + (q / 48).toString().padStart(2, '0')
                        meshes += model(conv.glb("prop-$id-${p.propSet}"), dir, name, materials, DoubleArray(3) { position[it] + offset[it] }, rotation.toDoubleArray(), scale.toDoubleArray())
                        placed += linkedMapOf("cell" to cell.toDouble(), "id" to id.toDouble(), "position" to position, "rotation" to rotation, "scale" to scale)
                    }
                    // cartridge plates are centred on the land cell (-16..16); the sampler takes cell coordinates (0..32)
                    val plates = Heights.plates(land.copyOfRange(land.size - bdhcSize, land.size)).map { pl ->
                        Plate(pl.x + 16, pl.y + 16, pl.w, pl.h, DoubleArray(12) { i -> pl.v[i] + if (i % 3 == 0) 16.0 else if (i % 3 == 1) -16.0 else 0.0 })
                    }
                    for (y in 0 until 32) for (x in 0 until 32) {
                        val plate = samplePlate(plates, x, y)
                        val blocked = permissions[(y * 32 + x) * 2 + 1].toInt() and 0x80 != 0
                        heights[cellY * 32 + y][cellX * 32 + x] = if (plate != null) round3(plate) else 0.0
                        typeRows[cellY * 32 + y][cellX * 32 + x] = if (blocked || plate == null) '#' else '.'
                    }
                }
                val types = typeRows.map { String(it) }
                val walk = roomWalk(meshes, types, heights)
                val entry = (spec["entry"] as List<Any?>?)?.map(::dbl) ?: selected[0].mapIndexed { i, v -> v - exitFacing[i] }
                if (types[entry[1].toInt()][entry[0].toInt()] == '#' || selected.any { types[it[1].toInt()][it[0].toInt()] == '#' }) error("Blocked room entrance")
                val source = linkedMapOf("game" to rom.code, "headerOffsetKind" to if (hg) "expanded-arm9" else "rom", "zone" to zone.toDouble(),
                    "headerOffset" to (table + zone * 24).toDouble(), "matrix" to matrixId.toDouble(), "land" to m.lands.map { it.toDouble() },
                    "area" to areaId.toDouble(), "texture" to p.textureId.toDouble(), "propSet" to p.propSet.toDouble(), "event" to eventId.toDouble(),
                    "props" to placed, "floorAdjustments" to walk.corrections)
                writeRoom(dir, materials, meshes, walkJson(cols, rows, types, heights, walk, entry),
                    linkedMapOf<String, Any?>("entry" to entry, "exits" to selected, "exitFacing" to exitFacing, "size" to listOf(cols.toDouble(), rows.toDouble()),
                        "meshes" to meshes.map { it.file }, "source" to source) + extras(spec))
                log("$room: ${meshes.size} meshes")
            }
        }

        class Matrix(val cols: Int, val rows: Int, val lands: List<Int>)
        fun matrix(buf: ByteArray): Matrix {
            val cols = buf[0].toInt() and 255; val rows = buf[1].toInt() and 255; val n = cols * rows
            val p = 5 + (buf[4].toInt() and 255) + (if (buf[2].toInt() != 0) n * 2 else 0) + (if (buf[3].toInt() != 0) n else 0)
            if (cols == 0 || rows == 0 || p + n * 2 > buf.size) error("Invalid room matrix")
            return Matrix(cols, rows, List(n) { u16(buf, p + it * 2) })
        }
        fun warps(buf: ByteArray): List<List<Double>> {
            var p = 0
            for (size in intArrayOf(20, 32)) { val n = u32(buf, p).toInt(); p += 4 + n * size }
            val count = u32(buf, p).toInt(); p += 4
            return List(count) { listOf(u16(buf, p + it * 12).toDouble(), u16(buf, p + it * 12 + 2).toDouble()) }
        }
        /** The 24-byte zone header table, found by three independently identified indoor areas. */
        fun platinumTable(arm9: ByteArray, at: Long): Long {
            val hits = ArrayList<Long>(); var p = 0
            while (p + 438 * 24 < arm9.size) {
                if (listOf(4 to 22, 422 to 20, 437 to 22).all { (id, area) -> arm9[p + id * 24].toInt() == area && arm9[p + id * 24 + 1].toInt() == 15 }) hits += at + p
                p += 4
            }
            if (hits.size != 1) error("Expected one Platinum zone table, found ${hits.size}")
            return hits[0]
        }
        fun heartgoldTable(arm: ByteArray): Long {
            val known = listOf(intArrayOf(60, 2, 0, 57), intArrayOf(76, 5, 0, 73), intArrayOf(185, 26, 73, 178), intArrayOf(183, 27, 109, 176), intArrayOf(536, 66, 286, 488))
            val hits = ArrayList<Long>(); var p = 0
            while (p + 537 * 24 <= arm.size) {
                if (known.all { (zone, area, matrix, event) -> val h = p + zone * 24
                        (arm[h + 1].toInt() and 255) == area && (u16(arm, h + 2) and 15) == 15 && u16(arm, h + 4) == matrix && u16(arm, h + 16) == event }) hits += p.toLong()
                p += 4
            }
            if (hits.size != 1) error("Expected one HeartGold header table")
            return hits[0]
        }
        /** HeartGold's ARM9 is stored with backwards LZ compression. */
        fun expandArm9(buf: ByteArray): ByteArray {
            val footer = u32(buf, buf.size - 8); val header = (footer ushr 24).toInt(); val compressed = (footer and 0xffffff).toInt()
            val extra = u32(buf, buf.size - 4).toInt()
            if (header < 8 || header > 11 || compressed > buf.size || extra > 0x800000) error("Invalid ARM9 compression")
            val out = buf.copyOf(buf.size + extra)
            var src = buf.size - header; var dst = out.size; val stop = buf.size - compressed
            while (src > stop) {
                val flags = out[--src].toInt() and 255; var mask = 128
                while (mask != 0 && src > stop) {
                    if (flags and mask != 0) {
                        val hi = out[--src].toInt() and 255; val lo = out[--src].toInt() and 255
                        val len = (hi ushr 4) + 3; val disp = ((hi and 15) shl 8 or lo) + 3
                        repeat(len) { --dst; if (dst < stop || dst + disp >= out.size) error("Invalid ARM9 back reference"); out[dst] = out[dst + disp] }
                    } else out[--dst] = out[--src]
                    mask = mask shr 1
                }
            }
            if (dst != stop) error("Invalid ARM9 expansion length")
            return out
        }
    }

    private class Plate(val x: Int, val y: Int, val w: Int, val h: Int, val v: DoubleArray)
    /** walk.js samplePlate: the highest plate over the tile centre. */
    private fun samplePlate(plates: List<Plate>, x: Int, y: Int): Double? {
        var best: Double? = null
        for (p in plates) {
            val lx = x + 0.5; val ly = y + 0.5
            if (lx < p.x || lx >= p.x + p.w || ly < p.y || ly >= p.y + p.h) continue
            val v = p.v; val a0 = v[0]; val a1 = -v[1]; val a2 = v[2]; val b0 = v[3]; val b1 = -v[4]; val b2 = v[5]; val c0 = v[6]; val c1 = -v[7]; val c2 = v[8]
            val det = (b0 - a0) * (c1 - a1) - (b1 - a1) * (c0 - a0)
            if (abs(det) < 1e-8) continue
            val u = ((lx - a0) * (c1 - a1) - (ly - a1) * (c0 - a0)) / det
            val v2 = ((ly - a1) * (b0 - a0) - (lx - a0) * (b1 - a1)) / det
            val height = a2 + u * (b2 - a2) + v2 * (c2 - a2)
            if (best == null || height > best) best = height
        }
        return best
    }

    // ---- generation five: Black 2 (interiors-bw.js) ----

    private class Gen5(val rom: Rom, val conv: Converter) {
        fun export(specs: List<Map<String, Any?>>, data: File, log: (String) -> Unit) {
            val headers = rom.narc("a/0/1/2")[0]; val areas = rom.file("a/0/1/3")
            val matrices = rom.narc("a/0/0/9"); val lands = rom.narc("a/0/0/8"); val textures = rom.narc("a/0/1/4")
            val bundles = rom.narc("a/2/2/6"); val propTextures = rom.narc("a/1/7/5"); val events = rom.narc("a/1/2/6")
            class Cell(val cell: Int, val id: Int, val b: ByteArray, val ox: Int, val oy: Int)
            class Plan(val spec: Map<String, Any?>, val area: Int, val matrix: Int, val event: Int, val propSet: Int, val texture: Int, val cols: Int, val rows: Int, val landIds: List<Int>)
            val plans = specs.map { spec ->
                val zone = num(spec["zone"]); val room = spec["room"] as String
                if (!Regex("^[-a-z0-9_]+$").matches(room) || zone < 0 || (zone + 1) * 48 > headers.size) error("Invalid Black 2 room definition")
                val h = headers.copyOfRange(zone * 48, (zone + 1) * 48); val area = u16(h, 2); val matrix = u16(h, 4); val event = u16(h, 22)
                val a = areas.copyOfRange(area * 10, area * 10 + 10)
                if (a[6].toInt() != 0) error("Expected indoor area")
                val mat = matrices[matrix]; val cols = u16(mat, 4) * 32; val rows = u16(mat, 6) * 32
                if (u32(mat, 0) != 0L || mat.size != 8 + cols * rows / 256) error("Unsupported Black 2 matrix")
                Plan(spec, area, matrix, event, u16(a, 0), u16(a, 2), cols, rows, List(cols * rows / 1024) { s32(mat, 8 + it * 4) })
            }
            fun cells(p: Plan) = p.landIds.withIndex().filter { it.value >= 0 }.map { (cell, id) ->
                val b = lands[id]; val sig = String(b, 0, 2, Charsets.ISO_8859_1); val sections = u16(b, 2)
                if (!((sig == "WB" && sections == 3) || (sig == "GC" && sections == 4))) error("Unsupported Black 2 permission container $sig")
                Cell(cell, id, b, (cell % (p.cols / 32)) * 32, (cell / (p.cols / 32)) * 32)
            }
            fun offsets(b: ByteArray): IntArray { val sections = u16(b, 2); return intArrayOf(u32(b, 4).toInt(), u32(b, 8).toInt(), u32(b, sections * 4).toInt(), u32(b, sections * 4 + 4).toInt(), sections) }
            fun bundleModel(propSet: Int, id: Int): Pair<Int, ByteArray> {
                val bundle = bundles[propSet]; val n = u16(bundle, 2)
                var index = -1
                for (j in 0 until n / 2) if (u16(bundle, u32(bundle, 4 + j * 4).toInt()) == id) index = j
                if (index < 0) error("Missing prop $id in bundle $propSet")
                val off = u32(bundle, 4 + (index + n / 2) * 4).toInt()
                if (String(bundle, off, 4, Charsets.ISO_8859_1) != "BMD0") error("Invalid bundled model")
                return index to bundle.copyOfRange(off, off + u32(bundle, off + 8).toInt())
            }
            for (p in plans) for (c in cells(p)) {
                val (start, per, props, _) = offsets(c.b).toList()
                conv.queue("map-${c.id}-${p.texture}", c.b.copyOfRange(start, per), textures[p.texture])
                for (i in 0 until u32(c.b, props).toInt()) {
                    val id = u16be(c.b, props + 4 + i * 16 + 14); val (index, bytes) = bundleModel(p.propSet, id)
                    conv.queue("prop-${p.propSet}-$index", bytes, propTextures[p.propSet])
                }
            }
            for (p in plans) {
                val spec = p.spec; val room = spec["room"] as String; val cols = p.cols; val rows = p.rows
                val north = spec["propNorthPositive"] == true
                val dir = File(data, "interiors/$room").apply { mkdirs() }
                val meshes = ArrayList<Mesh>(); val placed = ArrayList<Any?>(); val materials = LinkedHashMap<String, Any?>()
                val heights = Array(rows) { DoubleArray(cols) }; val typeRows = Array(rows) { CharArray(cols) { '#' } }
                for (c in cells(p)) {
                    val b = c.b; val (start, per, props, end) = offsets(b).toList()
                    if (start != u16(b, 2) * 4 + 8 || end != b.size || !(start < per && per < props && props < end)) error("Invalid Black 2 map offsets")
                    meshes += model(conv.glb("map-${c.id}-${p.texture}"), dir, "map-${c.cell}", materials, doubleArrayOf(c.ox.toDouble(), 0.0, c.oy.toDouble()), DoubleArray(3), doubleArrayOf(1.0, 1.0, 1.0))
                    val permission = b.copyOfRange(per, u32(b, 12).toInt())
                    if (u16(permission, 0) != 32 || u16(permission, 2) != 32) error("Invalid Black 2 permission size")
                    val values = Heights.bw2Terrain(permission)
                    for (y in 0 until 32) for (x in 0 until 32) {
                        val q = 4 + (y * 32 + x) * 8; val behavior = u16(permission, q + 4); val flags = u16(permission, q + 6)
                        val v = values[y * 32 + x]
                        heights[c.oy + y][c.ox + x] = (((0.0 + v[0]) + v[1]) + v[2] + v[3]) / 4
                        typeRows[c.oy + y][c.ox + x] = if (flags and 1 != 0 || behavior == 255) '#' else '.'
                    }
                    val count = u32(b, props).toInt(); val bundle = bundles[p.propSet]; val n = u16(bundle, 2)
                    if (String(bundle, 0, 2, Charsets.ISO_8859_1) != "AB" || n % 2 != 0 || props + 4 + count * 16 != end) error("Invalid Black 2 building table")
                    for (i in 0 until count) {
                        val q = props + 4 + i * 16; val id = u16be(b, q + 14)
                        val position = listOf(0, 4, 8).map { s32(b, q + it) / 65536.0 }; val rotation = listOf(0.0, u16(b, q + 12) * 360 / 65536.0, 0.0)
                        val (index, _) = bundleModel(p.propSet, id)
                        val at = doubleArrayOf(position[0] + c.ox, position[1], (if (north) -position[2] else position[2]) + c.oy)
                        meshes += model(conv.glb("prop-${p.propSet}-$index"), dir, "furniture-${c.cell}-$i", materials, at, rotation.toDoubleArray(), doubleArrayOf(1.0, 1.0, 1.0))
                        placed += linkedMapOf("cell" to c.cell.toDouble(), "id" to id.toDouble(), "bundle" to p.propSet.toDouble(), "index" to index.toDouble(), "position" to position, "rotation" to rotation)
                    }
                }
                // the cartridge's warp rectangles; DS units at tile centres
                val ev = events[p.event]; val warpCount = ev[6].toInt() and 255; val warpStart = 8 + (ev[4].toInt() and 255) * 20 + (ev[5].toInt() and 255) * 36
                val warp = spec["warp"]?.let { num(it) } ?: 0
                if (warp >= warpCount) error("Missing entrance warp")
                val q = warpStart + warp * 20; val x = u16(ev, q + 8) / 16.0 - 0.5; val y = u16(ev, q + 12) / 16.0 - 0.5
                val width = u16(ev, q + 14); val depth = u16(ev, q + 16)
                val exits = ArrayList<List<Double>>(); for (yy in 0 until depth) for (xx in 0 until width) exits += listOf(x + xx, y + yy)
                if (exits.isEmpty() || exits.any { e -> e.any { it != floor(it) } }) error("Invalid warp rectangle")
                val exitFacing = (spec["exitFacing"] as List<Any?>?)?.map(::dbl) ?: listOf(0.0, 1.0)
                val entry = (spec["entry"] as List<Any?>?)?.map(::dbl) ?: listOf(x + width / 2 - exitFacing[0], y - exitFacing[1])
                val types = typeRows.map { String(it) }
                if (types.getOrNull(entry[1].toInt())?.getOrNull(entry[0].toInt()) != '.') error("Blocked Black 2 entrance $entry")
                val walk = roomWalk(meshes, types, heights)
                val source = linkedMapOf("game" to rom.code, "zone" to dbl(spec["zone"]), "matrix" to p.matrix.toDouble(), "land" to p.landIds.map { it.toDouble() },
                    "area" to p.area.toDouble(), "texture" to p.texture.toDouble(), "propSet" to p.propSet.toDouble(), "event" to p.event.toDouble(), "warp" to warp.toDouble(),
                    "props" to placed, "permissionLayer" to 0.0, "propNorthPositive" to north, "floorAdjustments" to walk.corrections)
                writeRoom(dir, materials, meshes, walkJson(cols, rows, types, heights, walk, entry),
                    linkedMapOf<String, Any?>("entry" to entry, "exits" to exits, "exitFacing" to exitFacing, "size" to listOf(cols.toDouble(), rows.toDouble()),
                        "meshes" to meshes.map { it.file }, "source" to source) + extras(spec))
                log("$room: ${meshes.size} meshes")
            }
        }
    }

    // ---- heights.js ----

    object Heights {
        private fun f(x: Double) = x.toFloat().toDouble()
        /** heights.js prints six places and its reader parses them back. */
        private fun six(x: Double) = (if (x == 0.0 && 1 / x < 0) "-0.000000" else fixed(x, 6)).toDouble()

        class BdhcPlate(val x: Int, val y: Int, val w: Int, val h: Int, val v: DoubleArray)
        fun plates(buf: ByteArray): List<BdhcPlate> {
            if (buf.size < 16 || String(buf, 0, 4, Charsets.ISO_8859_1) != "BDHC") error("Invalid BDHC header")
            val counts = IntArray(6) { u16(buf, 4 + it * 2) }; val sizes = intArrayOf(8, 12, 4, 8, 8, 2)
            val offsets = IntArray(6); var end = 16
            for (i in 0..5) { offsets[i] = end; end += counts[i] * sizes[i] }
            if (end > buf.size) error("Truncated BDHC sections")
            fun point(index: Int): IntArray { if (index >= counts[0]) error("Invalid BDHC point index"); val p = offsets[0] + index * 8; return intArrayOf(s32(buf, p) shr 16, s32(buf, p + 4) shr 16) }
            return List(counts[3]) { i ->
                val p = offsets[3] + i * 8; val (x, y) = point(u16(buf, p)); val (right, bottom) = point(u16(buf, p + 2)); val w = right - x; val h = bottom - y
                val incline = u16(buf, p + 4); val distance = u16(buf, p + 6)
                if (incline >= counts[1] || distance >= counts[2]) error("Invalid BDHC plane index")
                val n = offsets[1] + incline * 12; val nx = s32(buf, n); val ny = s32(buf, n + 4); val nz = s32(buf, n + 8)
                val d = -s32(buf, offsets[2] + distance * 4) / 65536.0
                var z = d
                if (nx != 0) z = d * Math.sqrt(1 + StrictMath.pow(nx.toDouble() / ny, 2.0)) - nx.toDouble() / ny * (if (nx > 0) right else x)
                else if (nz != 0) z = d * Math.sqrt(1 + StrictMath.pow(nz.toDouble() / ny, 2.0)) - nz.toDouble() / ny * (if (nz > 0) bottom else y)
                z = f(jsRound(z * 1000) / 1000).let { if (it == 0.0 || it.isNaN()) 0.0 else it }
                val vertices: DoubleArray = if (nz != 0) {
                    val rise = f(f(abs(nz.toDouble() / ny)) * h); val high = f(z + rise)
                    if (nz < 0) doubleArrayOf(x.toDouble(), -y.toDouble(), z, right.toDouble(), -y.toDouble(), z, right.toDouble(), -bottom.toDouble(), high, x.toDouble(), -bottom.toDouble(), high)
                    else doubleArrayOf(right.toDouble(), -y.toDouble(), high, x.toDouble(), -y.toDouble(), high, x.toDouble(), -bottom.toDouble(), z, right.toDouble(), -bottom.toDouble(), z)
                } else {
                    val rise = if (nx == 0) 0.0 else f(f(abs(nx.toDouble() / ny)) * w); val high = f(z + rise)
                    if (nx < 0) doubleArrayOf(x.toDouble(), -y.toDouble(), z, right.toDouble(), -y.toDouble(), high, right.toDouble(), -bottom.toDouble(), high, x.toDouble(), -bottom.toDouble(), z)
                    else doubleArrayOf(right.toDouble(), -y.toDouble(), z, x.toDouble(), -y.toDouble(), high, x.toDouble(), -bottom.toDouble(), high, right.toDouble(), -bottom.toDouble(), z)
                }
                BdhcPlate(x, y, w, h, DoubleArray(12) { k -> six(if (vertices[k] == 0.0) 0.0 else vertices[k]) })
            }
        }

        /** Black 2 permission corner heights, four per tile. */
        fun bw2Terrain(buf: ByteArray): List<DoubleArray> {
            val tail = 4 + 32 * 32 * 8
            if (buf.size < tail || u16(buf, 0) != 32 || u16(buf, 2) != 32) error("Invalid Black 2 permission size")
            fun plane(inclination: Int, distance: Int, x: Int, y: Int): Double {
                val slope = SLOPES[inclination] ?: error("Unsupported Black 2 inclination $inclination")
                if (distance >= DISTANCES.size) error("Invalid Black 2 distance index")
                val (sx, sy) = slope; val d = DISTANCES[distance]
                val intercept = f(d * Math.sqrt(1 + f(sx * sx) + f(sy * sy)))
                return f(f(f(sx * (x - 16)) + f(sy * (y - 16))) + intercept)
            }
            return List(32 * 32) { k ->
                val x = k % 32; val y = k / 32; val p = 4 + k * 8
                val inclination = u16(buf, p); val distance = u16(buf, p + 2)
                var top = inclination; var bottom = inclination; var topDistance = distance; var bottomDistance = distance
                if (inclination == 2) {
                    val c = tail + distance * 8
                    if (c + 8 > buf.size) error("Invalid Black 2 corner index")
                    top = u16(buf, c) - 1; bottom = u16(buf, c + 2) * 4; topDistance = u16(buf, c + 4); bottomDistance = u16(buf, c + 6)
                }
                doubleArrayOf(six(plane(top, topDistance, x, y)), six(plane(top, topDistance, x + 1, y)),
                    six(plane(bottom, bottomDistance, x + 1, y + 1)), six(plane(bottom, bottomDistance, x, y + 1)))
            }
        }

        /** The reference export's fractional-word conversion, six places, then single precision. */
        private fun constant(n: Int) = f(fixed((n shr 16) + (n and 65535) / 65535.0, 6).toDouble())
        private val SLOPES: Map<Int, Pair<Double, Double>> by lazy {
            val c = ::constant
            mapOf(0 to (0.0 to 0.0), 4 to (c(32768) to 0.0), 8 to (-5.0 to 0.0), 24 to (0.0 to c(32768)), 28 to (-c(32768) to 0.0), 32 to (0.0 to -1.0),
                44 to (1.0 to 0.0), 56 to (0.0 to 1.0), 64 to (-1.0 to 0.0), 68 to (0.0 to 5.0), 72 to (5.0 to 0.0), 76 to (0.0 to -5.0), 80 to (0.0 to -c(32768)),
                120 to (2.0 to 0.0), 124 to (-2.0 to 0.0), 128 to (0.0 to -2.0), 132 to (0.0 to 2.0), 176 to (-1.0 to 1.0), 212 to (-4.0 to 0.0), 216 to (4.0 to 0.0),
                228 to (0.0 to -4.0), 232 to (1.0 to -4.0), 240 to (-c(98304) to -1.0), 276 to (-1.0 to -1.0), 308 to (c(229376) to -3.0), 348 to (-8.0 to -1.0),
                384 to (c(491520) to c(32768)), 428 to (-c(294912) to -1.0), 444 to (0.0 to 4.0), 448 to (-5.0 to -1.0), 456 to (-4.0 to -1.0), 460 to (1.0 to -5.0),
                472 to (-1.0 to -c(98304)), 504 to (8.0 to 3.0), 524 to (1.0 to -1.0), 528 to (4.0 to -1.0), 532 to (5.0 to -1.0), 536 to (-1.0 to -8.0), 544 to (7.0 to 0.0),
                548 to (0.0 to -7.0), 572 to (c(98304) to -1.0), 588 to (0.0 to 13.0), 592 to (13.0 to 0.0), 620 to (0.0 to -13.0), 632 to (12.0 to 0.0), 660 to (8.0 to -1.0),
                752 to (-1.0 to -4.0), 756 to (1.0 to 1.0), 1048 to (-1.0 to 17.0), 1080 to (-1.0 to -17.0), 1096 to (17.0 to -1.0), 1104 to (-17.0 to -1.0),
                1120 to (-1.0 to 8.0), 1148 to (-1.0 to 14.0), 1168 to (-1.0 to -14.0), 1184 to (0.0 to 12.0), 1208 to (0.0 to -12.0), 1216 to (-8.0 to 3.0),
                1220 to (-8.0 to -3.0), 1244 to (c(425984) to -c(163840)), 1248 to (c(425984) to c(163840)), 1264 to (-c(98304) to c(98304)))
        }
        /** Gonhex's Black 2 distance lookup, read from heights.js so the two never drift apart. */
        @Volatile var distanceSource: () -> String = { error("HubRooms.Heights.distanceSource not set") }
        private val DISTANCES: DoubleArray by lazy {
            val js = distanceSource()
            val body = js.substring(js.indexOf("const distances = [") + 19, js.indexOf("].map(constant)"))
            body.split(',').map { it.trim() }.filter { it.isNotEmpty() }.map { constant(it.toInt()) }.toDoubleArray()
        }
    }

    // ---- numbers as JavaScript writes them ----

    /** Number.prototype.toFixed. */
    fun fixed(x: Double, places: Int): String {
        if (x.isNaN()) return "NaN"
        val s = BigDecimal(abs(x)).setScale(places, RoundingMode.HALF_UP).toPlainString()
        return if (x < 0) "-$s" else s
    }
    private fun round3(x: Double) = jsRound(x * 1000) / 1000
    /** Math.round: to the nearest, halves up. */
    private fun jsRound(x: Double): Double { val r = floor(x); return if (x - r >= 0.5) r + 1 else r }
    /** V8's Math.hypot (scaled, compensated sum). */
    private fun hypot(v: DoubleArray): Double {
        var m = 0.0; for (x in v) { val a = abs(x); if (a.isNaN()) return Double.NaN; if (a > m) m = a }
        if (m == 0.0) return 0.0
        var sum = 0.0; var comp = 0.0
        for (x in v) { val n = abs(x) / m; val summand = n * n - comp; val pre = sum + summand; comp = (pre - sum) - summand; sum = pre }
        return Math.sqrt(sum) * m
    }

    private fun num(v: Any?): Int = (v as Number).toInt()
    private fun dbl(v: Any?): Double = (v as Number).toDouble()
    private fun u16(b: ByteArray, p: Int) = (b[p].toInt() and 255) or ((b[p + 1].toInt() and 255) shl 8)
    private fun u16be(b: ByteArray, p: Int) = ((b[p].toInt() and 255) shl 8) or (b[p + 1].toInt() and 255)
    private fun s16(b: ByteArray, p: Int) = u16(b, p).toShort().toInt()
    private fun s32(b: ByteArray, p: Int) = u16(b, p) or (u16(b, p + 2) shl 16)
    private fun u32(b: ByteArray, p: Int) = s32(b, p).toLong() and 0xffffffffL

    // ---- JSON as JSON.parse reads and JSON.stringify(value, null, 2) writes ----

    object Json {
        fun parse(s: String): Any? = Reader(s).run { val v = value(); ws(); v }
        private class Reader(val s: String) {
            var i = 0
            fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
            fun value(): Any? {
                ws()
                return when (s[i]) {
                    '{' -> { i++; val m = LinkedHashMap<String, Any?>(); ws(); if (s[i] == '}') { i++; return m }
                        while (true) { ws(); val k = str(); ws(); i++; m[k] = value(); ws(); if (s[i++] == '}') break }; m }
                    '[' -> { i++; val l = ArrayList<Any?>(); ws(); if (s[i] == ']') { i++; return l }
                        while (true) { l += value(); ws(); if (s[i++] == ']') break }; l }
                    '"' -> str()
                    't' -> { i += 4; true }; 'f' -> { i += 5; false }; 'n' -> { i += 4; null }
                    else -> { val st = i; while (i < s.length && s[i] in "+-0123456789.eE") i++; s.substring(st, i).toDouble() }
                }
            }
            fun str(): String {
                i++; val b = StringBuilder()
                while (s[i] != '"') {
                    if (s[i] == '\\') { i++; when (val c = s[i++]) {
                        'n' -> b.append('\n'); 't' -> b.append('\t'); 'r' -> b.append('\r'); 'b' -> b.append('\b'); 'f' -> b.append('\u000c')
                        'u' -> { b.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                        else -> b.append(c) } }
                    else b.append(s[i++])
                }
                i++; return b.toString()
            }
        }

        fun write(v: Any?): String = StringBuilder().also { write(it, v, "") }.toString()
        private fun write(b: StringBuilder, v: Any?, indent: String) {
            when (v) {
                null -> b.append("null")
                is Boolean -> b.append(v)
                is Number -> b.append(number(v.toDouble()))
                is String -> quote(b, v)
                is Map<*, *> -> if (v.isEmpty()) b.append("{}") else {
                    b.append("{\n"); var first = true
                    for ((k, x) in v) { if (!first) b.append(",\n"); first = false; b.append(indent).append("  "); quote(b, k as String); b.append(": "); write(b, x, "$indent  ") }
                    b.append('\n').append(indent).append('}')
                }
                is List<*> -> if (v.isEmpty()) b.append("[]") else {
                    b.append("[\n"); var first = true
                    for (x in v) { if (!first) b.append(",\n"); first = false; b.append(indent).append("  "); write(b, x, "$indent  ") }
                    b.append('\n').append(indent).append(']')
                }
                else -> error("Cannot write $v")
            }
        }
        private fun quote(b: StringBuilder, s: String) {
            b.append('"')
            for (c in s) when {
                c == '"' -> b.append("\\\""); c == '\\' -> b.append("\\\\"); c == '\n' -> b.append("\\n"); c == '\r' -> b.append("\\r"); c == '\t' -> b.append("\\t")
                c == '\b' -> b.append("\\b"); c == '\u000c' -> b.append("\\f"); c < ' ' -> b.append("\\u").append(String.format("%04x", c.code))
                else -> b.append(c)
            }
            b.append('"')
        }
        /** Number.prototype.toString: the shortest digits that read back as the same number. */
        fun number(d: Double): String {
            if (d.isNaN() || d.isInfinite()) return "null"
            if (d == 0.0) return "0"
            if (d == floor(d) && abs(d) < 1e21) return BigDecimal(d).toPlainString()
            val bd = BigDecimal(java.lang.Double.toString(abs(d))).stripTrailingZeros()
            val digits = bd.unscaledValue().toString(); val k = digits.length; val n = k - bd.scale()
            val body = when {
                n in k..21 -> digits + "0".repeat(n - k)
                n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
                n in -5..0 -> "0." + "0".repeat(-n) + digits
                else -> digits[0] + (if (k > 1) "." + digits.substring(1) else "") + "e" + (if (n - 1 >= 0) "+" else "-") + abs(n - 1)
            }
            return if (d < 0) "-$body" else body
        }
    }
}
