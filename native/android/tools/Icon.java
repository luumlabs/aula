// El primer plano del icono adaptable: el icono de Aula (el del iPhone) reducido al centro y rodeado del mismo papel.
//   java native/android/tools/Icon.java <icono.png> <salida.png> <lado> <lado del dibujo> <color RRGGBB>
// Con Java (que la compilación ya necesita) en lugar de sips o ImageMagick: lo mismo en la Mac y en Linux.
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class Icon {
    public static void main(String[] a) throws Exception {
        BufferedImage src = ImageIO.read(new File(a[0]));
        int size = Integer.parseInt(a[2]);
        int inner = Integer.parseInt(a[3]);
        BufferedImage out = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setColor(new Color(Integer.parseInt(a[4], 16)));
        g.fillRect(0, 0, size, size);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int off = (size - inner) / 2;
        g.drawImage(src, off, off, inner, inner, null);
        g.dispose();
        ImageIO.write(out, "png", new File(a[1]));
    }
}
