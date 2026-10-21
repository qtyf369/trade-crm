import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import HomePage from '@/pages/HomePage/HomePage';
import CustomersPage from '@/pages/CustomersPage/CustomersPage';
import CustomerDetailPage from '@/pages/CustomerDetailPage/CustomerDetailPage';
import FollowUpsPage from '@/pages/FollowUpsPage/FollowUpsPage';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="followups" element={<FollowUpsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
