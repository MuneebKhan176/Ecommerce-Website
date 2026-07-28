// routes/adminSliderRoutes.js
//
// Admin-only management of the homepage "About Us" carousel images.
// Mount this at '/admin/api' in web.js (same base as adminStockRoutes).
//
// GET    /admin/api/slider
// POST   /admin/api/slider            (multipart, field "images" = up to 6 files)
// PUT    /admin/api/slider/:id        (caption / display_order / is_active, optional new image)
// DELETE /admin/api/slider/:id

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { requireAdmin } = require('../../middle/adminAuth');
const upload = require('../../utils/uploadMiddleware');
const { uploadImages, deleteImage, keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.use(verifyToken, requireAdmin);

// GET /slider — every slide, newest-configured order first, with public URLs attached
router.get('/slider', (req, res) => {
    conn.query(
        'SELECT * FROM homepage_sliders ORDER BY display_order ASC, slider_id ASC',
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            const slides = rows.map(s => ({ ...s, url: keyToUrl(s.cloud_key) }));
            return sendResponse(res, 200, true, 'Slider images fetched', slides);
        }
    );
});

// POST /slider   (multipart/form-data: images[], caption, display_order, is_active)
// Each uploaded file becomes its own slide row, sharing the caption/order
// fields if provided (order is auto-incremented per file so they don't
// all collide on the same position).
router.post('/slider', upload.array('images', 6), async (req, res) => {
    if (!req.files || !req.files.length) {
        return sendResponse(res, 400, false, 'At least one image is required');
    }

    const caption = req.body.caption?.trim() || null;
    const isActive = req.body.is_active === undefined ? true : !!Number(req.body.is_active);

    conn.query(
        'SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM homepage_sliders',
        async (orderErr, orderRows) => {
            if (orderErr) return sendResponse(res, 500, false, 'Database error', orderErr.message);

            const baseOrder = req.body.display_order ? Number(req.body.display_order) : orderRows[0].maxOrder;

            try {
                const uploaded = await uploadImages(req.files, 'homepage-slider');
                const values = uploaded.map((img, i) => [img.key, caption, baseOrder + i + 1, isActive]);

                conn.query(
                    'INSERT INTO homepage_sliders (cloud_key, caption, display_order, is_active) VALUES ?',
                    [values],
                    (insertErr) => {
                        if (insertErr) return sendResponse(res, 500, false, 'Database error', insertErr.message);
                        return sendResponse(res, 201, true, 'Slide(s) added', {
                            images: uploaded.map(i => ({ ...i, url: keyToUrl(i.key) })),
                        });
                    }
                );
            } catch (uploadErr) {
                return sendResponse(res, 500, false, 'Image upload to R2 failed', uploadErr.message);
            }
        }
    );
});

// PUT /slider/:id   (multipart/form-data, optional single new "images" file replaces the old one)
router.put('/slider/:id', upload.array('images', 1), (req, res) => {
    const { id } = req.params;
    const caption = req.body.caption?.trim() ?? null;
    const displayOrder = req.body.display_order !== undefined ? Number(req.body.display_order) : null;
    const isActive = req.body.is_active !== undefined ? !!Number(req.body.is_active) : null;

    conn.query('SELECT cloud_key FROM homepage_sliders WHERE slider_id = ?', [id], async (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'Slide not found');

        const fields = [];
        const params = [];

        if (caption !== null) { fields.push('caption = ?'); params.push(caption); }
        if (displayOrder !== null) { fields.push('display_order = ?'); params.push(displayOrder); }
        if (isActive !== null) { fields.push('is_active = ?'); params.push(isActive); }

        let newKey = null;
        if (req.files && req.files.length) {
            try {
                const [uploaded] = await uploadImages(req.files, 'homepage-slider');
                newKey = uploaded.key;
                fields.push('cloud_key = ?');
                params.push(newKey);
            } catch (uploadErr) {
                return sendResponse(res, 500, false, 'Image upload to R2 failed', uploadErr.message);
            }
        }

        if (!fields.length) return sendResponse(res, 400, false, 'Nothing to update');

        params.push(id);
        conn.query(`UPDATE homepage_sliders SET ${fields.join(', ')} WHERE slider_id = ?`, params, async (updErr) => {
            if (updErr) return sendResponse(res, 500, false, 'Database error', updErr.message);

            // Only clean up the old R2 object after the row update succeeds.
            if (newKey) {
                try { await deleteImage(rows[0].cloud_key); }
                catch (r2Err) { console.error('⚠️ Failed to delete old slider image:', r2Err.message); }
            }

            return sendResponse(res, 200, true, 'Slide updated');
        });
    });
});

// DELETE /slider/:id
router.delete('/slider/:id', (req, res) => {
    const { id } = req.params;

    conn.query('SELECT cloud_key FROM homepage_sliders WHERE slider_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'Slide not found');

        conn.query('DELETE FROM homepage_sliders WHERE slider_id = ?', [id], async (delErr, result) => {
            if (delErr) return sendResponse(res, 500, false, 'Database error', delErr.message);
            if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Slide not found');

            try { await deleteImage(rows[0].cloud_key); }
            catch (r2Err) { console.error('⚠️ Failed to delete R2 slider image:', r2Err.message); }

            return sendResponse(res, 200, true, 'Slide deleted');
        });
    });
});

module.exports = router;