"""Thin wrapper around the `qrcode` lib returning PNG bytes."""

import io

import qrcode
from qrcode.constants import ERROR_CORRECT_M


def png_bytes(text, box_size=10, border=2):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1f2a2e", back_color="#fffaf3")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
