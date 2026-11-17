import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { useStore } from '@/lib/store';

/** Entry: decides where to go from the sign-in and learner state. */
export default function Index() {
  const { ready, session, learner } = useStore();
  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (!learner) return <Redirect href="/learners" />;
  return <Redirect href="/home" />;
}
