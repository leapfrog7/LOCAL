package in.local.vault;

import java.io.File;
import com.tom_roush.pdfbox.io.MemoryUsageSetting;
import com.tom_roush.pdfbox.pdmodel.PDDocument;

final class PdfPasswordService {
    static void unlock(File source, File target, String password, File scratch, int maxPages) throws Exception {
        try (PDDocument pdf = PDDocument.load(source, password, MemoryUsageSetting.setupTempFileOnly().setTempDir(scratch))) {
            if (pdf.getNumberOfPages() > maxPages) throw new IllegalArgumentException("PDF import supports up to " + maxPages + " pages at a time.");
            pdf.setAllSecurityToBeRemoved(true);
            pdf.save(target);
        } catch (Exception error) { target.delete(); throw error; }
    }
}
