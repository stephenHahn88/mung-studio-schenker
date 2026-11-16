import { createHashRouter } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { InMemoryPage } from "./pages/InMemoryPage";
import { PerformanceTestingPage } from "./pages/PerformanceTestingPage";
import { DocumentsPage as SimpleBackendDocumentsPage } from "./pages/simple-backend/DocumentsPage";
import { DocumentEditorPage } from "./pages/simple-backend/DocumentEditorPage";
import { DocumentConversionPage } from "./pages/simple-backend/DocumentConversionPage";
import { AnnotationGuidePage } from "./pages/AnnotationGuidePage";

export const router = createHashRouter([
  {
    index: true,
    element: <HomePage />,
  },
  {
    path: "in-memory",
    element: <InMemoryPage />,
  },
  {
    path: "performance-testing",
    element: <PerformanceTestingPage />,
  },
  {
    path: "simple-backend",
    element: <SimpleBackendDocumentsPage />,
  },
  {
    path: "simple-backend/:documentName/conversion",
    element: <DocumentConversionPage />,
  },
  {
    path: "simple-backend/:documentName",
    element: <DocumentEditorPage />,
  },
  {
    path: "annotation-guide",
    element: <AnnotationGuidePage />,
  },
]);
